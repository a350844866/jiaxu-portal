# Serenity Dashboard — 设计文档

**日期**:2026-05-29
**仓库**:jiaxu-portal (Next.js 16 / React 19 / Tailwind 4 / shadcn)
**关联 vault 页**:[[serenity-活账本]] / [[serenity-weekly-*]] / [[aleabitoreddit]]

## 目的

让 [[Taieo]] 不开 vault 就能盯 Serenity (@aleabitoreddit) 的:**持仓动向 + 预测对账(打假)+ 推文原始流**。是 [[serenity-活账本]] 周报蒸馏体系的可视化前端。

三目标(承自蒸馏 brainstorming):
1. **盯仓 / 跟单线索** — 他现在拿着什么、本周动了什么
2. **学打法** — 已在活账本/trade-signals 沉淀,dashboard 不重复(只链过去)
3. **打假 / track record** — 预测对账可视化,自报数字显式标"不可证伪"

## 数据架构(决策:JSON sidecar)

dashboard 吃**两类结构化数据,全部只读**:

| 数据 | 源 | 谁产生 | 容器内路径 |
|------|----|----|----|
| 推文 corpus(图表 + 浏览器) | `tweets-full.json`(2728 条,id/text/timestamp/likes/url/media) | daily-sync cron(已有) | `/data/x-corpus/tweets-full.json` |
| 策展账本(持仓表/对账表/catalyst) | `ledger.json`(**新**) | **蒸馏 SOP 增产**(同一次分析,markdown + JSON 双吐) | `/data/x-corpus/ledger.json` |

**为什么 JSON sidecar 而非 parse markdown**:活账本 markdown 表格格式一改,parser 就崩;sidecar 是结构化契约,稳。JSON 落在 data plane(`/data/x-exports/`)不进 vault,符合 [[CLAUDE]] §6"vault 只 markdown"。markdown 活账本仍是 Taieo 在 Obsidian 看的人类版,JSON 是机器版,同一次蒸馏产出无 drift。

### ledger.json schema(蒸馏 SOP 增写)

```json
{
  "updated": "2026-05-29",
  "last_distilled_ts": "2026-05-28T19:09:33.000Z",
  "self_reported": { "ytd_pct": 4502.45, "two_year_pct": 22561.99, "as_of": "2026-05-26" },
  "positions": [
    {
      "ticker": "SIVE", "name": "Sivers", "chain": "CPO/光子激光上游",
      "stance": "加码",            // 🆕新开|🔥加码|➡️持有|📉减仓|🔄反手做空|🤫转静默
      "thesis": "Ayar/Lightmatter 的 sole-source 激光;$2.6B→喊 next $LITE",
      "instrument": "现货", "last_mention": "2026-05-28", "status": "active"
    }
  ],
  "predictions": [
    {
      "date": "2026-05-28", "claim": "$EWY 2028 LEAPs +428% / 5.2x",
      "falsifiable": "options 难独立核", "verdict": "待核",   // 兑现|落空|待核|不可证伪|归因不稳
      "due": null, "note": ""
    }
  ],
  "catalysts": [
    { "date": "~2026-06-01", "event": "$SIVE 指数被动流入", "chain": "$SIVE" }
  ]
}
```

判定枚举与活账本 §2 对齐:`兑现`/`落空`/`待核`/`不可证伪`(自报无审计)/`归因不稳`(结论对模型错)。

## 组件架构

**路由**:portal 子页 `/serenity`(server component,`revalidate = 30`,镜像 `/wife-mt4` 与 TodoCard 模式)。走 portal 现有 auth + NPM 公网入口。

**lib 读取层**(镜像 `todo-reader.ts`):
- `src/lib/serenity-reader.ts` — 读 `ledger.json` + `tweets-full.json`,返回结构化 snapshot;读失败返回 `{ok:false, error}` 不崩页(同 `readTodoSnapshot` 容错模式)
  - `CORPUS_DIR = process.env.SERENITY_CORPUS_DIR || "/data/x-corpus"`
  - 推文 likes 字段是字符串("1.2K"/"72")→ 解析成数字供图表/排序用,保留原串供显示
  - 暴露:`readLedger()` / `readTweets(opts)`(支持 ticker/date/minLikes 过滤)/ 派生 `tweetCountByDay()` / `tickerMentionCounts()` / `verdictBreakdown()`

**页面分区**(重档 4 区,server 取数 → client 交互壳):
1. **顶栏 KPI 条** — 持仓数 / 本周新动作数 / 待核预测数 / 自报 YTD(标 🚫 不可证伪 badge)
2. **持仓网格** — 卡片按 chain 分组,stance 色标(🔥红/➡️灰/📉蓝/🆕绿);点卡 → client 抽屉下钻该 ticker 在 corpus 的原推
3. **图表区**(手搓 SVG/CSS,**不加图表依赖**):
   - 发推量时间线(按天柱状)
   - ticker 提及热力(本周哪些票被反复砸)
   - 预测命中率环图(✅/❌/⏳/🚫 占比)
4. **推文浏览器** — 全 corpus 可搜可筛(ticker / 日期 / minLikes),每条挂原 X 链;client 组件,分页/虚拟滚动防 2728 条卡顿

**client/server 边界**:取数与派生全在 server(`serenity-reader`);只有"搜索框/筛选/抽屉开合"是 client(`"use client"` 子组件接 props)。避免 [[CLAUDE]] 记的 SSR hydration race(portal 既有坑)。

## 图表实现

现有 deps **无图表库**(无 recharts)。三个图都简单(柱状/热力格/环图)→ **手搓 SVG + Tailwind**,匹配 portal 极简暗色风,零新依赖。真要复杂时序交互再议加库。

## 部署

1. `docker-compose.yml` volumes 加一条:`/data/x-exports/aleabitoreddit:/data/x-corpus:ro`
2. environment 加 `SERENITY_CORPUS_DIR=/data/x-corpus`
3. (可选)`services-data.ts` 加 serenity 卡片入口
4. `docker compose up -d --build --force-recreate`(per [[feedback-post-commit-deploy]])
5. 部署后 `docker exec jiaxu-portal ls /data/x-corpus/` spot-check 文件存在(per [[reference-docker-compose-build-silent-noop]])

## 测试

- `serenity-reader` 单测(vitest,镜像 `__tests__/mac-mini-alarms.test.ts` 模式):
  - likes 字符串解析("1.2K"→1200 / "72"→72)
  - ticker 过滤 / date 过滤 / minLikes 过滤
  - ledger 缺失时容错返回 `{ok:false}`
  - 派生函数:tweetCountByDay / tickerMentionCounts / verdictBreakdown
- 提供 fixture(小 corpus + ledger 样本)避免依赖真实 2728 条

## 蒸馏 SOP 联动

[[serenity-活账本]] §4 SOP 加一步:**蒸馏时同步写 `/data/x-exports/aleabitoreddit/ledger.json`**(持仓表/对账表/catalyst 的结构化镜像)。markdown 给人看,JSON 给 dashboard,同一次分析双吐。首次建 dashboard 时由本 spec 实施阶段一并生成 ledger.json 初版(从已写好的活账本 markdown 转录)。

## 不做(YAGNI)

- 不做实时价格拉取(IBKR 2FA 故障 + 欧股休市,价格核对仍 opportunistic)
- 不做编辑功能(dashboard 只读;策展在蒸馏环节由 Claude 做)
- 不做多 KOL 通用化(目前只 aleabitoreddit,过度抽象是浪费)
- 不引图表库(三图手搓够用)

## 范围边界

- **vault 不动**:dashboard 是 portal 仓的事;只在蒸馏 SOP 加一步写 ledger.json
- **trade-signals / deep-v2 不进 dashboard**:那是"学打法"静态库,dashboard 链过去即可,不重复渲染
