# FeErrorCard — 首页前端报错聚合卡 设计

> 2026-07-06。背景:公司生产 golden 前端当日上线「浏览器错误主动上报」(vault [[前端错误上报方案]]),
> 错误以 `FE_ERROR {json}` 单行落 VictoriaLogs。本卡把它聚合到 portal 首页,与 LogHealthCard 并列。
> 用户已批准形态:三大数字 + top5 签名列表。

## 数据流

- 新 API `GET /api/logs/fe-errors`(无入参,窗口固定 24h → 零注入面),挂 /api/logs 家族:
  同一 `isAuthed()` 会话门禁(生产日志敏感,SECURITY CONTRACT 同 guard.test.ts)+ vlogs 服务端代理。
- LogsQL: `_time:24h "FE_ERROR" | limit 5000`(app 无关——将来 7 仓铺开零改动;
  `FE_ERROR_ENDPOINT_FAIL` 等变体是不同 token 不会命中,且解析层天然过滤)。
- 服务端逐行剥 `FE_ERROR ` 标记后的 JSON:
  - 聚合 by `sig`:次数(Σ max(1,count))、影响人数(staffId 去重)、样本 message/route/type/app、
    lastSeen(取 NDJSON `_time`,不信 payload ts)。
  - 全局:total / users / sigs / parseFailed(坏行计数,不炸)。top 按次数降序取 8,卡片渲 5。

## 隔离单元(照 vlogs 三层模式)

| 文件 | 职责 |
|---|---|
| `src/lib/fe-errors-pure.ts` | LogsQL 构造 + NDJSON→聚合纯函数(client-safe,可单测) |
| `src/lib/vlogs.ts` 增 `feErrorSummary()` | server-only IO(复用 vlogsFetch) |
| `src/app/api/logs/fe-errors/route.ts` | isAuthed + 调 IO;VlogsError→502,同 logs route |
| `src/components/dashboard/fe-error-card.tsx` | 纯渲染;挂 service-grid `cat.id==="company"` 块 |

## 卡片行为

- 三大数字:24h 条数 / 影响人数 / 签名数;top5 列表:type 色点(vue=violet/js=rose/promise=amber/api=sky/resource=zinc)
  + message 截断 + route · N次 · 相对时间;条目点击 → `/logs?service=golden-service-web&keyword=<sig>`。
- 空态=emerald「24h 无前端错误」;401=复用 LogHealthCard「点此登录」回跳;vlogs 失败=rose 错误行。
- 手动刷新按钮,load-on-mount,同 LogHealthCard 模式。

## 不做(YAGNI)

时间窗切换 / 告警推送 / 独立路由页 / app→service 动态映射(单试点期硬链 golden-service-web,铺开时再做)。

## 测试

- pure: 构造含 _time:24h+"FE_ERROR"+limit;同 sig 聚合(count 求和/人数去重/lastSeen 取最大 _time);
  脏 JSON 行→parseFailed 不炸;无标记行忽略;count=0 按 1 计;排序取 top。
- route: 未登录 401;authed+mock vlogs→200 shape。
- 部署后 e2e:家服 mint session JWT → curl authed 返回真实聚合(当日生产验收探针可当数据);登录浏览器目检卡片。
