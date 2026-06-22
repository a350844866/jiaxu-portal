# jiaxu-portal 生产日志查看器 — 设计 (2026-06-22)

> 修订 v2(2026-06-22):纳入 Codex adversarial review 的 11 条(关键词注入转义、errorOnly 错误预设、no-cache 部署、_stream 跨 pod 累加、anti-SSRF、Node runtime、server-only、健康口径诚实化、失败日志粒度、limit/排序默认)。

## 背景与目标

2026-06-22 sms 验证码登录事故(`@JsonProperty(WRITE_ONLY)` 打穿 Redis 缓存 → 全员登录 NPE,112 次/1.5h,靠人肉投诉才发现)暴露:生产服务出错时,运维只能手敲 vlogs LogsQL 才能定位。本项目在 jiaxu-portal 加一个**运维友好、按服务分组**的生产日志查看器。

**目标**
1. 首页一张「生产日志·错误一览」卡片:28 个 Nacos 生产服务按逻辑组排列,谁在冒错一眼看到(红/绿)。
2. `/logs` 检索页:选服务 / 时间窗 / 关键词,可只看错误、可自动刷新(5s)。
3. 数据源 = 生产 VictoriaLogs(`portal.company.liulin.work/vlogs/`),portal 后端代理,浏览器不直连;访问受 portal 会话保护。

**非目标(YAGNI)**:告警(已有测试机 `prod-error-monitor.py`)、日志写入/留存、非 Nacos 服务、日志下载导出、跨命名空间、**任何"裸 LogsQL"入参接口**(见安全)。

## 架构

```
浏览器(portal 已登录, 带会话 cookie)
 ├─ 首页 LogHealthCard      → GET /api/logs/health?window=1h
 └─ /logs 页 (LogsPanel)    → GET /api/logs?service&window&keyword&errorOnly&limit
后端(Next.js App Router, runtime=nodejs):
 - src/config/log-services.ts   逻辑组 → 服务 → vlogs 容器名(单一真相源)
 - src/lib/vlogs.ts             vlogs 客户端 + LogsQL 构造 + 转义 + 时区/解析(import "server-only")
 - src/app/api/logs/route.ts        某服务日志查询(会话校验 + 入参白名单化)
 - src/app/api/logs/health/route.ts 全服务错误一览(一条聚合, 会话校验)
      └─ fetch GET ${VLOGS_BASE_URL}/select/logsql/query  (无 secret, 靠家服 IP 白名单)
```

家服出口 IP 在 vlogs NPM 白名单内(自动同步),vlogs 仅 IP 白名单、不需要 secret(实测无 header 即 200)。`VLOGS_BASE_URL` 是**固定配置 origin,绝不来自请求参数**(防认证后 SSRF)。

## 隔离单元

### 1. `src/config/log-services.ts`（配置,纯数据,无依赖)
- `LOG_GROUPS: { group: string; services: { name: string; container: string }[] }[]`。
- 28 个生产 Nacos `product` 注册服务;3 处「注册名 ≠ 容器名」映射:`4gcard→my4gcard`、`auto-itsm-server→auto-itsm-core`、`internal-manage-web→internal-manage-web-server`。
- 逻辑组(合计 28):**登录链路**(auth-web/auth-server/sms-server/staff-server/staff-4a-server/staff-4a-msg-receive-server)· **金牌**(golden-service-server/golden-service-web)· **工作流**(activiti/seata-server)· **open 平台**(open-api/open-server/open-dingtalk-server)· **内部管理**(internal-manage-server/internal-manage-web-server)· **其它业务**(oss-server/ctdfs-server/form-server/portal-web/my4gcard/auto-itsm-core/auto-itsm-web/big-data-middle-platform-sync-server/integrity-business-management-server/integrity-business-management-web/data-inspection-server/data-inspection-web/portal-server)。
- helper:`containerOf`、`serviceByName`、`allContainers`、`isKnownService`。
- 单测:总数=28、3 映射、双向一致、分组无遗漏/重复。

### 2. `src/lib/vlogs.ts`（vlogs 客户端,顶部 `import "server-only"`)
- `queryLogs({ container, window, keyword?, errorOnly?, limit })`
  - LogsQL = `_time:<window> {path=~".*<container>.*"}` + (errorOnly ? ` <ERROR_PRESET>`:``) + (keyword ? ` ` + `quoteLogsQLString(keyword)`:``) + ` | limit <limit>`(vlogs 侧也截断)。
  - **path 过滤已实测**:`{path=~".*<container>.*"}` 与 `path:~"<container>"` 两种都只返回该容器自己日志(裸全文服务名会误中别处提到该名的行,故必须 path 过滤);用前者,联调跑 live smoke 复核。
  - **`quoteLogsQLString(s)`(安全,关键)**:转义 `\` 和 `"`,包成 `"..."` 短语;**含 `|` 或控制字符 → 拒绝**(API 层 400),防把 LogsQL 拼成 `| stats`/改写查询(已登录用户仍是生产日志注入面)。配恶意关键词单测。
  - **`ERROR_PRESET`**(errorOnly):`("ERROR" OR "Exception" OR "Caused by" OR "Got unchecked and undeclared exception" OR "exceptionHandler" OR "FATAL")`——不止裸 `ERROR`,否则漏掉本功能要抓的 Dubbo/NPE 形态。
  - 解析 NDJSON → `LogLine { tUtc, tLocal(+8h 北京), level, container, msg }`;level 从行首 `[LEVEL]`/` LEVEL ` 提取(缺省 "—");**按时间倒序**返回。
- `healthCounts(containers, window)`
  - `_time:<window> ("exceptionHandler" OR "Got unchecked and undeclared exception") | stats by (_stream) count() c`;解析每个 `_stream`→容器名,**同一容器的所有 stream/pod(重启/多副本会有多条)累加**(不假设 1 stream=1 服务),只留传入 containers。高信号、基线≈0。
- `fetch` 带超时(AbortController 20s);失败/超时/非200 → throw **带类型**(403/timeout/badStatus/parse/missingEnv)。
- 依赖 `VLOGS_BASE_URL`(固定 env)+ log-services。单测:LogsQL 构造 + 恶意关键词 + NDJSON 解析 + 错误兜底(mock fetch)。

### 3. `src/app/api/logs/route.ts` + `.../health/route.ts`（契约层)
- 两路 `export const runtime = "nodejs"` + `dynamic = "force-dynamic"`(verifySessionToken 走 Node crypto/fs)。
- **会话校验**(两路):`cookies()` 读 `COOKIE_NAME` → `verifySessionToken`,无效 → 401。**日志比首页遥测(token/metrics 等当前未设防)敏感得多,故这两路有意更严**,用与 `/api/auth/verify` 相同会话原语。
- `/api/logs`:`?service&window=30m&keyword&errorOnly=0&limit=200`;校验 service ∈ 已知(400)、window ∈ 白名单(15m/30m/1h/3h/6h/1d)、limit 默认 200 范围 [1,1000](非法回默认)、keyword 经 `quoteLogsQLString`(含 `|`/控制字符 → 400)。→ `{ lines }`(时间倒序)。**只接受白名单化 service/window/keyword/errorOnly,LogsQL 后端拼,绝不暴露裸 LogsQL 入参**(anti-SSRF/任意查询)。
- `/api/logs/health`:`?window=1h` → `{ window, counts, ts }`。
- vlogs 失败 → 502 `{error:"日志源暂不可达"}`(用户向);**后端日志区分** 403(白名单/家宽 IP 可能未同步)/timeout/非200/解析失败/缺 env。

### 4. `src/components/dashboard/log-health-card.tsx`（首页卡片,client)
- fetch `/api/logs/health?window=1h`,按 `LOG_GROUPS` 渲染:每组一行,服务芯片 名称 + 状态点(n>0 红+数字 / n=0 绿)。
- **口径诚实**:绿 ≠ "全健康",只表示"近窗口**无未处理异常**信号";普通 ERROR/DB 池失败/CrashLoop/无日志服务不在此信号内 → 卡片标题注明窗口 + 信号口径。
- 手动 ⟳ 刷新;失败显示"日志源暂不可达"。点芯片 → `/logs?service=<name>&errorOnly=1`;角「全部日志 →」→ `/logs`。
- 视觉沿用现有 dashboard 卡片(zinc / Tailwind),import 进 `src/app/page.tsx`。

### 5. `src/app/logs/page.tsx` + `LogsPanel`（检索页,client)
- 控件:服务(按 LOG_GROUPS 分组下拉)、时间窗、关键词、☐只看错误、☐自动刷新5s、查询。URL query 同步(可分享/直达,卡片点进来带 service & errorOnly)。
- 日志区:时间(北京)+ 级别(配色)+ 服务 + msg;长行点击展开;空态/错误态文案。
- 自动刷新:开启时 `setInterval` 5s 重查,卸载清理。

## 安全 / 鉴权
- `/logs` + `/api/logs*` 显式校验 portal 会话(`verifySessionToken`),未登录 401/跳登录。
- vlogs 仅后端访问(家服 IP 白名单,无 secret);浏览器不接触 vlogs URL。
- **anti-SSRF**:`VLOGS_BASE_URL` 固定 env、不接受请求参数指定目标;不提供裸 LogsQL 接口,只白名单化参数后端拼。
- keyword 注入防护见 §2 `quoteLogsQLString`。只读,绝不写。

## 错误处理
- vlogs 超时/不可达/403/非200/解析失败 → API 502 `{error}` + 后端按类型记;前端"暂不可达"不崩。
- 无结果 → 空态;service 非法 → 400;keyword 含元字符 → 400;未登录 → 401。

## 测试
- `log-services.ts`:28/3映射/分组完整/双向。
- `vlogs.ts`:LogsQL 构造(各组合)+ **恶意关键词被拒/转义** + NDJSON 解析(level/时区/倒序)+ 错误兜底(mock fetch)。
- API:契约(会话、参数、limit 边界、502 兜底)。
- 组件:渲染冒烟(红绿、空态、错误态)。
- **真实联调**:连生产 vlogs——健康一览有数 / `{path=~}` 过滤只返回该容器(live smoke)/ `/logs` 查 auth-web 有日志 / 点芯片直达 / errorOnly 抓到 Dubbo/NPE 形态。

## 部署
- portal env 加 `VLOGS_BASE_URL=https://portal.company.liulin.work/vlogs`。
- **新增多个文件,按 portal 硬规则 no-cache 重建**:`docker compose build --no-cache jiaxu-portal` + `up -d --force-recreate jiaxu-portal`,并**进容器 spot-check 新文件确已打进**(standalone 产物漏带新文件的坑)。
- 家服出口 IP 白名单已含(自动同步);若家宽 IP 漂移致 502,等同步或手动更白名单。

## 风险 / 取舍
- 家服 IP 漂移窗口健康卡可能短暂 502(有空态兜底)。
- 健康信号只算未处理异常(避噪);普通 ERROR 在 /logs 用 errorOnly 预设/关键词另查。
- /logs 不做实时 tail,用自动刷新 5s 近似(YAGNI)。
