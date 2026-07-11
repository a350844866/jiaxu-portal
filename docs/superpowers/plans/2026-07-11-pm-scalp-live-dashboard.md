# pm-scalp 实盘 Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 独立的 `/pm-scalp/real` 实盘页 + tab 双页导航 + 首页卡 LIVE 行，展示 recon 真金账本（对账口径与链上余额一致）。

**Architecture:** 新 `pm-scalp-real-reader.ts`（纯函数核心 `buildRealSnapshot(ledgerLines, paperLines, opts)` 可单测 + 薄 fs 壳），新 API 路由，新 server-component 页面（inline SVG 净值曲线），tabs 共用组件，卡片双 fetch 独立降级。Spec: `docs/superpowers/specs/2026-07-11-pm-scalp-live-dashboard-design.md`（Codex 10 条已吸收，为权威口径）。

**Tech Stack:** Next.js App Router (server components) / vitest / tailwind zinc 暗色语言（严格沿用现有 pm-scalp 页面样式惯例）。

## Global Constraints

- reader 只读 `real/recon-ledger.jsonl`、`real/recon.pid`、`paper/trades.jsonl`；lstat 拒 symlink；绝不触碰 `real/.env`、`real/derived-creds.json`
- 所有权判定：`fill.taker_order_id===oid` → taker lot(`fill.price`,`fill.size`)；否则 `maker_orders[].order_id===oid` → maker lot(`m.price`,`m.matched_amount`)；证据不全(|Σsize−matched|>0.01) → `uncertain` 排除出权威合计
- 费：taker lot `0.07·px·(1−px)·size` 求和；maker lot 0
- alarms 只含固定枚举 + 窗口号 + oid 前 10 字符
- 金额一律 `tabular-nums`；页面口径文案写明"已实现权益"

---

### Task 1: pm-scalp-real-reader（纯函数核心 + fs 壳）+ 测试

**Files:**
- Create: `src/lib/pm-scalp-real-reader.ts`
- Test: `src/lib/__tests__/pm-scalp-real-reader.test.ts`

**Interfaces:**
- Produces: `readPmScalpRealSnapshot(): Promise<PmScalpRealSnapshot>`（fs 壳）与 `buildRealSnapshot(reconLines: string[], paperLines: string[], opts: { running: boolean; nowSec: number }): PmScalpRealSnapshot`（纯函数，测试直打）。类型按 spec `PmScalpRealSnapshot`/`RealTradeRow`/`RealTradeStatus`/`OwnedLot` 原文。

- [ ] **Step 1: 写失败测试**（fixture 用真实账本结构精简副本）：taker 单件（T2 形态：limit 0.34 fill 0.30 won → net +3.4265、fee 0.0735）/ maker 单件（727400 形态：taker_order_id≠oid、maker_orders 含 oid@0.47 → fee 0、fillPxAvg 0.47）/ 证据缺失（无 fills_sample → uncertain 且不进 netTotal）/ pending（order 无终态）/ nofill / unresolved 进 alarms / 重复 settle 取首条+alarm / equity 曲线累计与 start 检查点（无 pending 时偏差>0.01 → alarm）/ 批次口径（55−5=50 分母、done 按批锚后 order 数）/ 配对（exec:3 entry match、miss→sim-missed、侦察期 era-mismatch、side-mismatch）/ 空文件空态
- [ ] **Step 2: `npx vitest run src/lib/__tests__/pm-scalp-real-reader.test.ts`** — 全 FAIL（模块不存在）
- [ ] **Step 3: 实现**——解析（坏行跳过）→ oid 状态机（首 order/首终态、冲突 alarm）→ 所有权 lots → fee/netPnl → equity（certain 终态逐点）→ start 检查点 → 批次 → N4 配对（era 规则：实盘 ts ≥ 1783713000(04:10) 只配 exec:3；更早标 era-mismatch）→ 汇总。fs 壳：三路径 lstat isFile 且非 symlink 后读，recon.pid 存在→running
- [ ] **Step 4: vitest 全绿**
- [ ] **Step 5: commit** `feat(pm-scalp): 实盘账本 reader(所有权/lot 级费用/uncertain 门/权益曲线)`

### Task 2: API 路由 + 门禁验证

**Files:**
- Create: `src/app/api/pm-scalp/real/route.ts`（照抄 `src/app/api/pm-scalp/route.ts` 结构，换 reader 与错误文案）
- Modify: 无（`proxy.ts` 只验证不改）

- [ ] **Step 1: 建路由**（force-dynamic / revalidate 0 / no-store / 503 降级）
- [ ] **Step 2: 门禁实测**：`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/api/pm-scalp/real`（未带 cookie）— 预期 401/302/403（与 `/api/pm-scalp` 未登录行为一致；若 200 则 STOP，去 proxy.ts 补 matcher）
- [ ] **Step 3: commit** `feat(pm-scalp): /api/pm-scalp/real 只读快照路由`

### Task 3: tabs 组件 + `/pm-scalp/real` 页面（读 dataviz skill 后再写 SVG）

**Files:**
- Create: `src/app/pm-scalp/tabs.tsx`（`PmScalpTabs({ active: "paper" | "real" })`，两 Link，active 高亮 zinc-100/边框，非 active zinc-500 hover）
- Create: `src/app/pm-scalp/real/page.tsx`（server component、force-dynamic；结构照 spec §3：tab→状态条 4 格→权益 SVG→逐单表→alarms 红条→口径 footer）
- Modify: `src/app/pm-scalp/page.tsx`（header 下插 `<PmScalpTabs active="paper" />`，其余不动）

- [ ] **Step 1:** 先 `Skill: dataviz`（硬触发：写图前必读），SVG 曲线按其配色/可读性规范；处理 0/1 点与全平序列（min==max 时固定中线，禁 NaN）
- [ ] **Step 2:** tabs.tsx + real/page.tsx + page.tsx 插桩；样式严格沿用现页（rounded-2xl border-zinc-800 bg-zinc-900/40 等）；表格列：窗口(+08)/方向/挂价/成交均价+maker徽标/费/状态/净额/模拟配对徽章（绿 match ≤1c、黄 px-gap+数值、紫 sim-missed、灰 era-mismatch/无记录、琥珀 side-mismatch）
- [ ] **Step 3:** `npm run build` 过 + 本地起服后两页互切、实数据渲染正确（对照终端里已知的 7 单真实数据肉眼核对净额）
- [ ] **Step 4: commit** `feat(pm-scalp): 实盘专页+tab 双页导航`

### Task 4: 首页卡 LIVE 行

**Files:**
- Modify: `src/components/dashboard/pm-scalp-card.tsx`

- [ ] **Step 1:** `Promise.allSettled` 双 fetch（`/api/pm-scalp` + `/api/pm-scalp/real`）；real 失败 → 灰字"实盘数据不可用"，不影响模拟盘区
- [ ] **Step 2:** LIVE 行：`●`(running&&lastEventAge<1800 绿脉冲/否则灰) + `实盘 $已实现权益` + `本批 done/denominator` + `W-L` + 净额色值；整行 Link → `/pm-scalp/real`，`pointer-events-auto relative z-20`（兄弟层级，不嵌套 anchor）
- [ ] **Step 3:** build + 首页肉眼验证 + commit `feat(pm-scalp): 首页卡实盘 LIVE 行`

### Task 5: 部署 + 实测 + Codex 代码 review 收口

- [ ] **Step 1:** `npx vitest run`（全套）+ `npm run build` 全绿
- [ ] **Step 2:** Codex 代码 review（用户明示场景；staging 无密钥副本审 4 个新/改文件 diff，effort high）；Critical/Important 全修
- [ ] **Step 3:** `docker compose up -d --build --force-recreate` + `docker exec ls` spot-check 新文件（防 build cache noop）+ 线上两页/卡片/门禁 curl 复测
- [ ] **Step 4:** push + vault writeback（[[pm-scalp微结构实验]] portal 段 + [[jiaxu-portal]] + log.md）

## Self-Review

- Spec 覆盖：双页 tab ✓ / reader 口径 10 条 ✓ / API 门禁实测 ✓ / SVG 边界 ✓ / allSettled ✓ / 兄弟链接 ✓ / 安全 alarms 白名单 ✓ / YAGNI（无 websocket/归档视图）✓
- 类型一致：`PmScalpRealSnapshot` 等名称与 spec 原文一致，Task 3/4 只消费 Task 1 类型
- 无占位符：核心算法口径全部落在 Global Constraints + Task 1 步骤文字，代码级细节以 spec 数据结构为准
