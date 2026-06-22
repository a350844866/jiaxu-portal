# jiaxu-portal 生产日志查看器 — 设计 (2026-06-22)

## 背景与目标

2026-06-22 sms 验证码登录事故(`@JsonProperty(WRITE_ONLY)` 打穿 Redis 缓存 → 全员登录 NPE,112 次/1.5h,靠人肉投诉才发现)暴露:生产服务出错时,运维只能手敲 vlogs LogsQL 才能定位。本项目在 [[jiaxu-portal]] 加一个**运维友好、按服务分组**的生产日志查看器。

**目标**
1. 首页一张「生产日志·错误一览」卡片:28 个 Nacos 生产服务按逻辑组排列,谁在冒错一眼看到(红/绿)。
2. `/logs` 检索页:选服务 / 时间窗 / 关键词,可只看错误、可自动刷新(5s)。
3. 数据源 = 生产 VictoriaLogs(`portal.company.liulin.work/vlogs/`),portal 后端代理,浏览器不直连;访问受 portal 会话保护。

**非目标(YAGNI)**:告警(已有测试机 `prod-error-monitor.py`)、日志写入/留存策略、非 Nacos 服务(中间件/前端/其它命名空间)、日志下载导出、跨命名空间。

## 架构

```
浏览器(portal 已登录, 带会话 cookie)
 ├─ 首页 LogHealthCard      → GET /api/logs/health?window=1h
 └─ /logs 页 (LogsPanel)    → GET /api/logs?service&window&keyword&errorOnly&limit
后端(Next.js App Router, server-only):
 - src/config/log-services.ts   逻辑组 → 服务 → vlogs 容器名(单一真相源)
 - src/lib/vlogs.ts             vlogs 查询客户端 + LogsQL 构造 + 时区/解析
 - src/app/api/logs/route.ts        某服务日志查询(会话校验)
 - src/app/api/logs/health/route.ts 全服务错误一览(一条聚合, 会话校验)
      └─ fetch GET ${VLOGS_BASE_URL}/select/logsql/query  (无 secret, 靠家服 IP 白名单)
```

家服(192.168.31.66)出口 IP 在 vlogs NPM 白名单内(自动同步),且 vlogs 仅做 IP 白名单、不需要 `X-Portal-Proxy` secret(实测无 header 即 200)。故后端直接 fetch 即可。

## 隔离单元

### 1. `src/config/log-services.ts`（配置,纯数据,无依赖)
- 导出 `LOG_GROUPS: { group: string; services: { name: string; container: string }[] }[]`。
- 28 个生产 Nacos `product` 注册服务;3 处「注册名 ≠ 容器名」映射:`4gcard→my4gcard`、`auto-itsm-server→auto-itsm-core`、`internal-manage-web→internal-manage-web-server`。
- 逻辑组:**登录链路**(auth-web/auth-server/sms-server/staff-server/staff-4a-server/staff-4a-msg-receive-server)· **金牌**(golden-service-server/golden-service-web)· **工作流**(activiti/seata-server)· **open 平台**(open-api/open-server/open-dingtalk-server)· **内部管理**(internal-manage-server/internal-manage-web-server)· **其它业务**(oss/ctdfs/form/portal-web/my4gcard/auto-itsm-core/auto-itsm-web/big-data-middle-platform-sync-server/integrity-business-management-server/integrity-business-management-web/data-inspection-server/data-inspection-web/portal-server)。
- 导出 helper:`containerOf(service)`、`serviceByName(name)`、`allContainers()`、`isKnownService(name)`。
- 可独立单测:服务总数=28、3 处映射正确、service↔container 双向一致、分组无遗漏/重复。

### 2. `src/lib/vlogs.ts`（vlogs 客户端,server-only)
- `queryLogs({ container, window, keyword?, errorOnly?, limit }): Promise<LogLine[]>`
  - LogsQL = `_time:<window> {path=~".*<container>.*"}` + (errorOnly ? ` ERROR` : ``) + (keyword ? ` ` + 引号包裹的关键词 : ``)。
  - 用 `{path=~}` 流过滤(实测:裸全文服务名会误中别的容器里提到该名的行,必须用 path 过滤)。
  - 解析 NDJSON → `LogLine { tUtc, tLocal(+8h 北京), level, container, msg }`;level 从行首 `[LEVEL]` / ` LEVEL ` 正则提取(INFO/WARN/ERROR/DEBUG,缺省 "—")。
- `healthCounts(containers, window): Promise<Record<container, number>>`
  - 一条聚合:`_time:<window> ("exceptionHandler" OR "Got unchecked and undeclared exception") | stats by (_stream) count() c`,解析 `_stream`→容器名,只留传入 containers 的计数(= 监控用同款高信号:HTTP 未处理异常 + Dubbo provider 崩溃,健康基线≈0)。
- `fetch` 带超时(AbortController, 20s);失败/超时 throw（由 API 层兜成 502）。
- 依赖:`process.env.VLOGS_BASE_URL`、log-services。可独立测(mock fetch 验 LogsQL 构造 + NDJSON 解析 + 错误兜底)。

### 3. `src/app/api/logs/route.ts` + `src/app/api/logs/health/route.ts`（契约层)
- **会话校验**(两路均):读 `COOKIE_NAME` cookie → `verifySessionToken`;无效 → 401 `{error:"未登录"}`。(比现有未设防的数据 API 多一道,因日志敏感。)
- `/api/logs`:`?service=&window=30m&keyword=&errorOnly=0&limit=200`;校验 service ∈ 已知(否则 400)、window ∈ 白名单(15m/30m/1h/3h/6h/1d)、limit ≤ 1000。→ `{ lines: LogLine[] }`。
- `/api/logs/health`:`?window=1h` → `{ window, counts: {container:n}, ts }`。
- vlogs 不可达 → 502 `{error:"日志源暂不可达"}`。

### 4. `src/components/dashboard/log-health-card.tsx`（展示,首页卡片)
- client component,fetch `/api/logs/health?window=1h`,按 `LOG_GROUPS` 渲染:每组一行,组内服务芯片显示 名称 + 状态点(n>0 红+数字 / n=0 绿)。
- 手动 ⟳ 刷新按钮;失败显示"日志源暂不可达"。
- 点服务芯片 → `/logs?service=<name>&errorOnly=1`;卡片角「全部日志 →」链到 `/logs`。
- 视觉沿用现有 dashboard 卡片(zinc 暗色 / Tailwind),`import` 进 `src/app/page.tsx` 卡片网格。

### 5. `src/app/logs/page.tsx` + `LogsPanel`（展示,检索页)
- 控件:服务选择(按 LOG_GROUPS 分组下拉)、时间窗(下拉白名单)、关键词输入、☐只看错误、☐自动刷新5s、查询按钮。
- URL query 同步(可分享/直达;卡片点进来带 `service` & `errorOnly`)。
- 日志区:每行 时间(北京)+ 级别(配色 INFO 灰/WARN 黄/ERROR 红)+ 服务 + msg;长行点击展开;空态「该条件下无日志」/错误态文案。
- 自动刷新:开启时 `setInterval` 每 5s 重查当前条件,组件卸载清理。

## 数据流
1. 卡片挂载 → `/api/logs/health?window=1h` → vlogs 一条聚合 → 各服务异常计数 → 渲染红绿。
2. 点服务芯片 → `/logs?service=X&errorOnly=1` → LogsPanel 读 query → `/api/logs?...` → vlogs 查询 → 渲染日志行。
3. 自动刷新:LogsPanel 定时重发 `/api/logs`。

## 安全 / 鉴权
- `/logs` 页 + `/api/logs*` 显式校验 portal 会话(`verifySessionToken`);未登录 401/跳登录。
- vlogs 仅后端访问(家服 IP 白名单,无 secret);浏览器不接触 vlogs URL,你的浏览器无需进白名单。
- 只读:仅查询 vlogs,绝不写。
- 无新密钥;`VLOGS_BASE_URL` 是公开 URL,加进 portal env。

## 错误处理
- vlogs 超时/不可达 → API 502 `{error}` → 前端显"日志源暂不可达,稍后重试",不崩。
- 无结果 → 空态文案。service 非法 → 400;未登录 → 401。

## 测试
- `log-services.ts`:单测(28 服务 / 3 映射 / 分组完整 / service↔container)。
- `vlogs.ts`:单测 LogsQL 构造(各参数组合)+ NDJSON 解析(level/时区)+ 错误兜底(mock fetch)。
- API:契约测(会话校验、参数校验、502 兜底)。
- 组件:渲染冒烟(健康红绿、空态、错误态)。
- 真实联调:连生产 vlogs 跑一遍(健康一览有数、/logs 查 auth-web 有日志、点芯片直达)。

## 部署
- portal env 加 `VLOGS_BASE_URL=https://portal.company.liulin.work/vlogs`。
- `docker compose up -d --build`(portal 标准发版)。
- 家服 IP 白名单已含(自动同步);若家宽 IP 漂移致 502,等同步或手动更白名单(同 vlogs 直查行为)。

## 风险 / 取舍
- 家服 IP 漂移窗口内健康卡可能短暂 502(可接受,有空态兜底)。
- 健康信号只算"未处理异常",不算普通 ERROR(避免噪声;ERROR 级在 /logs 页用关键词/只看错误另查)。
- /logs 不做实时 tail(用自动刷新 5s 近似),YAGNI。
