# pm-scalp 实盘 dashboard 设计（2026-07-11）

用户决策：实盘与模拟盘**分 tab、俩独立页面**，不混排；范围"全家桶"（状态条 + 净值曲线 + 逐单表 + 模拟配对列 + 首页卡 LIVE 行）。

## 背景

`/data/pm-scalp/real/` 下的 recon.py 在真实 Polymarket 账户执行 N4 策略（2026-07-11 起 50 单累计批次，账本 `recon-ledger.jsonl` append-only）。已实盘验证的对账口径：maker 成交零费、taker 费 = 7%×p×(1−p)×股数（按实际成交价），逐单可对平链上余额。portal 容器已挂 `/data/pm-scalp:ro`。

## 页面结构（tab 双页）

- `/pm-scalp` — 模拟盘页，**保持现有内容不动**，仅顶部加 tab 栏
- `/pm-scalp/real` — 实盘专页（本次新建），同样带 tab 栏
- tab 栏：`模拟盘 | 实盘` 两个 Link，当前页高亮；样式沿用 zinc 暗色语言，放 header 下方

## 新组件与数据流

### 1. `src/lib/pm-scalp-real-reader.ts`（新文件，与 paper reader 分离）

只读三个路径（**绝不触碰 `real/.env` / `derived-creds.json`**）：
- `real/recon-ledger.jsonl` — 主账本
- `real/recon.pid` — 存在即 recon 运行中（进程退出/收尾会删锁）
- `paper/trades.jsonl` — 仅为同窗 N4 配对（entry/miss/settle 按 w 过滤）

导出 `readPmScalpRealSnapshot(): Promise<PmScalpRealSnapshot>`：

```ts
type RealTradeStatus = "pending" | "won" | "lost" | "nofill" | "unresolved" | "uncertain"

interface OwnedLot { px: number; size: number; maker: boolean }   // 我方在一笔 fill 里的份额

interface RealTradeRow {
  w: number; windowLabel: string; sideUp: boolean
  limitPx: number
  status: RealTradeStatus
  lots: OwnedLot[]                             // 所有权判定后的我方成交明细（见下）
  fillPxAvg: number | null                     // Σpx·size/Σsize（仅 certain 时）
  makerRatio: number | null                    // maker size 占比
  fee: number | null                           // Σ taker lot 0.07·px·(1−px)·size（maker lot 0）
  matched: number | null
  netPnl: number | null                        // 仅 won/lost 且 certain；其余 null
  postLatencyMs: number | null
  disp: number | null
  sim: { kind: "entry" | "miss" | "none" | "era-mismatch"; px?: number; missReason?: string; won?: boolean }
  simDivergence: "match" | "px-gap" | "side-mismatch" | "sim-missed" | null
}
interface PmScalpRealSnapshot {
  ok: boolean; generatedAt: string
  running: boolean                             // recon.pid 存在
  lastEventAgeSeconds: number | null
  batch: { capTrades: number; capNotional: number; resumed: number; denominator: number; done: number; pending: number } | null
  balanceStart: number                         // 首个 start.collateral（锚点）
  realizedEquity: number                       // 锚点 + Σ certain 终态净额（**已实现权益**，非实时余额）
  openCostBound: number                        // 在途单按限价的占用上界（UI 标 ~）
  uncertainCount: number                       // 证据不全被排除出权威合计的单数
  netTotal: number; wins: number; losses: number; nofills: number; pending: number
  makerLotRatio: number | null                 // 全部 certain lots 的 maker size 占比
  equity: { ts: number; balance: number }[]    // 已实现权益曲线；start 记录不产生点
  trades: RealTradeRow[]                       // 全量倒序
  alarms: string[]                             // 仅固定枚举文案 + 窗口号 + oid 前 10 字符，禁止 dump 原始记录/异常文本
}
```

**所有权与费用（治 Codex C1/C2）**：`fills_sample` 里每条 fill——
- `fill.taker_order_id === 我方 oid` → taker lot：px=`fill.price`，size=`fill.size`
- 否则扫 `fill.maker_orders[]`，`m.order_id === 我方 oid` → maker lot：px=`m.price`，size=`m.matched_amount`
- 两者都不命中 → 该 fill 不属于本单，跳过
- fee = Σ taker lots `0.07·px·(1−px)·size`；maker lots 零费
- **证据完整性门**（治 C3）：`|Σ owned size − matched| > 0.01` 或 fills_sample 缺失 → status=`uncertain`，**排除出 netTotal/equity/realizedEquity/胜负计数**，行上标 ⚠、计入 uncertainCount 与 alarms；绝不用限价+估费混进权威合计

**生命周期状态机（治 C6）**：以 oid 为键——order（重复 oid 取首条并报 alarm）→ 恰一条终态（settle/nofill/unresolved，取首条，后续冲突终态报 alarm）。settle-without-order → alarm 且不进表。won/lost 仅来自 certain settle；nofill 不进胜率分母；unresolved → status + alarms。

**已实现权益与曲线（治 C4/C5）**：realizedEquity = 锚点 + Σ certain 终态净额，UI 明示"已实现权益"，在途占用以限价上界单列（~$x）。每条 start 记录做检查点：若该时点无 pending 且其前所有单皆 certain，则 |start.collateral − 当时点已实现权益| > $0.01 → alarm（附检查点时间）；start 永不重置/贡献 equity 点。

**批次口径（治 C7）**：以最新 start 为批锚——denominator = capTrades − resumed（当前 55−5=50）；done = 批锚后已下 order 数（与 recon 自身 trades 计数同义，nofill/unresolved 均算 done）；pending 单列。

- `nofill` → 行状态"未成交"，不计费不计盈亏
- 全部 best-effort：文件缺失/坏行降级为空态，不 throw（沿用 paper reader 惯例）；三个白名单路径读取前 lstat 拒绝 symlink

### 2. `src/app/api/pm-scalp/real/route.ts`（新）

`GET` → `readPmScalpRealSnapshot()` JSON。与现有 `/api/pm-scalp` 同构（force-dynamic、错误 500 + {error}）。

### 3. `/pm-scalp/real/page.tsx`（新，server component，force-dynamic）

自上而下：
1. **tab 栏**（模拟盘/实盘）
2. **状态条** 4 格：运行灯(recon.pid+账本新鲜度)/批次进度 done/50 + 进度条/当前余额+累计净额/maker 占比+平均 POST 延迟
3. **净值曲线**：inline SVG 折线（服务端渲染，无新依赖），起点 $50.94，标注侦察批(5单)与累计批分界竖线；遵循 dataviz skill 配色与可读性规范
4. **逐单表**：时间/方向/挂价/实际成交均价(maker徽标)/费/状态/净额/**模拟配对列**。配对规则（治 Codex C8）：
   - 只取 `v==="N4"`；实盘单所在时代与模拟 exec 版本对齐——实盘批次 2+（2026-07-11 04:10 后）只配 `exec:3` 记录，更早的侦察 5 单配对结果标 `era-mismatch`（当时模拟还是 v2 语义，对比无意义）
   - 同窗既有 entry 又有 miss → entry 优先；重复记录取文件序首条
   - 方向不同 → `side-mismatch`（独立标签，不算价格匹配）
   - 价差比较基准 = 实盘**实际成交均价**（uncertain 时退挂价并标 ~）；≤1c `match` 绿 / >1c `px-gap` 黄+数值 / 模拟 miss 而实盘成交 `sim-missed` 紫
   - `none` 显示"无记录"（模拟盘该窗未扫到/未落账）
5. alarms 非空时顶部红条透出
6. footer 口径说明：净额=实际成交价+实收费口径（与链上余额逐单对平），账本毛口径(-limit价、不含费)仅存于 recon 自身日志

### 4. tab 栏抽出 `src/app/pm-scalp/tabs.tsx` 小组件

两页共用（`模拟盘` → `/pm-scalp`，`实盘` → `/pm-scalp/real`），props: `active: "paper" | "real"`。

### 5. 首页卡 `pm-scalp-card.tsx` 加 LIVE 行

- 并行 fetch `/api/pm-scalp/real`；行内容：`🔴 LIVE` 灯（running && 新鲜）+ 余额 + 本批 x/50 + W-L + 净额
- 整行 `pointer-events-auto` Link → `/pm-scalp/real`（卡片整体仍链到 /pm-scalp，沿用刷新按钮的分层模式）
- real API 失败不影响卡片模拟盘部分（独立降级为"实盘数据不可用"一行灰字）

## 测试

`src/lib/__tests__/pm-scalp-real-reader.test.ts`：fixture 账本覆盖——taker 成交/maker 成交(费=0、fillPx=limit)/在途单/nofill/unresolved 透出 alarms/equity 累计与 start 锚点校验/配对三态(match、px-gap、sim-missed)/文件缺失空态。

## 安全（含 Codex C9）

- reader 白名单只读上述三个文件，读取前 lstat 拒绝 symlink；不新增任何秘密相关路径
- **实现时验证 `proxy.ts` 中间件 matcher 确实覆盖 `/api/pm-scalp/real`**（现有注释称全局门禁覆盖所有非公开路径，需实测 401/302 而非只信注释）
- alarms 只输出固定枚举文案 + 窗口号 + oid 截断（前 10 字符），禁止序列化原始记录或异常文本进 payload
- 余额/盈亏属 personal-financial 数据，portal 登录门禁内展示（现状已展示同类个人数据）

## 实现要点备忘（Codex minor）

- SVG 净值曲线处理 0 点/1 点/全平序列（禁 NaN/除零属性）
- 首页卡双 fetch 用 `Promise.allSettled` 或独立 catch（一路失败不拖垮另一路）
- 卡内 LIVE 行链接与整卡覆盖 Link 保持兄弟层级（沿用刷新按钮 pointer-events 分层模式），不嵌套 anchor

## 不做（YAGNI）

- 不做实时推送/websocket（force-dynamic + 手动刷新够用，与现有页一致）
- 不做历史批次归档视图（账本还只有一批；等多批后再说）
- 不改 recon.py 任何行为（dashboard 纯只读）
