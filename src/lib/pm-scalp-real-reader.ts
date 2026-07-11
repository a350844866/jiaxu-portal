/**
 * pm-scalp 实盘（recon.py 真金账本）state reader。
 *
 * 与 pm-scalp-reader.ts（模拟盘）刻意分离：实盘是金融记录，口径以
 * docs/superpowers/specs/2026-07-11-pm-scalp-live-dashboard-design.md 为权威
 * （Codex design review 10 条 + code review 11 条已吸收）。核心是纯函数
 * buildRealSnapshot——fs 壳只负责读三个白名单文件，所有会算错钱的逻辑都可单测直打。
 *
 * 白名单（绝不读 real/.env、real/derived-creds.json）：
 *   real/recon-ledger.jsonl — append-only 账本 {type:start|order|settle|nofill|unresolved|order_error|end}
 *   real/recon.pid          — 存在即 recon 运行中（进程收尾/退出时删除）
 *   paper/trades.jsonl      — 仅取 N4 记录做同窗配对
 *
 * 对账口径（2026-07-11 实盘 20 单逐单对平链上余额至 3e-5 USD 验证）：
 *   - fill 所有权：fill.taker_order_id === 我方 oid → taker lot（价=fill.price）；
 *     否则扫 maker_orders[].order_id === 我方 oid → maker lot（价=m.price）。
 *     顶层 trader_side 在 maker 成交时描述的是对手聚合事件，不可用作我方角色。
 *   - 费：taker lot Σ 0.07·px·(1−px)·size；maker lot 零费。
 *   - 铁律：任何证据不全或字段畸形（matched/won/px 非法）→ uncertain/告警，
 *     绝不让 NaN 或猜测值进入权威合计（netTotal/realizedEquity/equity 曲线）。
 */
import { promises as fs } from "node:fs"
import path from "node:path"

/** papertrader exec v3（合成流动性+GTC 语义）上线时刻：更早的实盘单与 v2 模拟对比无意义 */
export const EXEC_V3_SINCE = 1783714200 // 2026-07-11 04:10 +08

export type RealTradeStatus = "pending" | "won" | "lost" | "nofill" | "unresolved" | "uncertain"

export interface OwnedLot {
  px: number
  size: number
  maker: boolean
}

export interface RealTradeRow {
  w: number
  windowLabel: string
  /** 稳定行键: oid 前 10 字符（同窗多单时 w 不唯一） */
  oid10: string
  sideUp: boolean
  limitPx: number
  status: RealTradeStatus
  lots: OwnedLot[]
  fillPxAvg: number | null
  makerRatio: number | null
  fee: number | null
  matched: number | null
  netPnl: number | null
  postLatencyMs: number | null
  disp: number | null
  sim: { kind: "entry" | "miss" | "none" | "era-mismatch"; px?: number; missReason?: string; won?: boolean }
  simDivergence: "match" | "px-gap" | "side-mismatch" | "sim-missed" | null
}

export interface PmScalpRealSnapshot {
  ok: boolean
  generatedAt: string
  running: boolean
  lastEventAgeSeconds: number | null
  batch: {
    capTrades: number
    capNotional: number
    resumed: number
    denominator: number
    done: number
    pending: number
    anchorTs: number
  } | null
  balanceStart: number
  realizedEquity: number
  openCostBound: number
  uncertainCount: number
  netTotal: number
  wins: number
  losses: number
  nofills: number
  pending: number
  makerLotRatio: number | null
  equity: { ts: number; balance: number }[]
  trades: RealTradeRow[]
  alarms: string[]
}

function scalpDir(): string {
  return process.env.PM_SCALP_DIR ?? "/data/pm-scalp"
}

function windowLabel(w: number): string {
  return new Date(w * 1000).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

const oidShort = (oid: unknown): string => (typeof oid === "string" ? oid.slice(0, 10) : "?")
/** alarm 只允许有限数字或 "?" 进入插值（治告警通道透传畸形值） */
const numSafe = (v: unknown): string => (typeof v === "number" && Number.isFinite(v) ? String(v) : "?")
const finite = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = Record<string, any>

function parseLines(lines: string[]): Rec[] {
  const out: Rec[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const d = JSON.parse(line)
      if (d && typeof d === "object") out.push(d)
    } catch {
      /* 坏行跳过 */
    }
  }
  return out
}

/** 从 fills_sample 提取我方 lots；价格必须落在 (0,1) 开区间（份额价域），否则不算证据 */
function ownedLots(fills: unknown, oid: string): OwnedLot[] {
  const lots: OwnedLot[] = []
  if (!Array.isArray(fills)) return lots
  for (const f of fills as Rec[]) {
    if (!f || typeof f !== "object") continue
    if (f.taker_order_id === oid) {
      const px = finite(f.price)
      const size = finite(f.size)
      if (px != null && size != null && px > 0 && px < 1 && size > 0)
        lots.push({ px, size, maker: false })
      continue
    }
    for (const m of Array.isArray(f.maker_orders) ? (f.maker_orders as Rec[]) : []) {
      if (m && m.order_id === oid) {
        const px = finite(m.price)
        const size = finite(m.matched_amount)
        if (px != null && size != null && px > 0 && px < 1 && size > 0)
          lots.push({ px, size, maker: true })
      }
    }
  }
  return lots
}

const takerFee = (px: number, size: number) => 0.07 * px * (1 - px) * size

interface SimN4 {
  /** 仅 exec:3 的记录（era 严格：v3 时代只认 v3 语义） */
  entry3?: { px: number; sideUp: boolean }
  miss3?: { reason: string }
  /** 是否见过 exec<3 的 N4 记录（用于 era-mismatch 判定） */
  legacy: boolean
  won?: boolean
}

function collectSimN4(paperRecs: Rec[], windows: Set<number>): Map<number, SimN4> {
  const byW = new Map<number, SimN4>()
  for (const d of paperRecs) {
    if (d.v !== "N4" || typeof d.w !== "number" || !windows.has(d.w)) continue
    const cur = byW.get(d.w) ?? { legacy: false }
    const exec = Number(d.exec ?? 0)
    if (d.type === "entry") {
      if (exec >= 3) {
        if (cur.entry3 === undefined) {
          const px = finite(d.px)
          if (px != null) cur.entry3 = { px, sideUp: Boolean(d.side_up) }
        }
      } else cur.legacy = true
    } else if (d.type === "miss") {
      if (exec >= 3) {
        if (cur.miss3 === undefined) cur.miss3 = { reason: String(d.reason ?? "?") }
      } else cur.legacy = true
    } else if (d.type === "settle" && cur.won === undefined) {
      cur.won = Boolean(d.won)
    }
    byW.set(d.w, cur)
  }
  return byW
}

export function buildRealSnapshot(
  reconLines: string[],
  paperLines: string[],
  opts: { running: boolean; nowSec: number },
): PmScalpRealSnapshot {
  const recs = parseLines(reconLines)
  const alarms: string[] = []

  // ---- oid 状态机: 首 order + 首终态 ----
  interface TradeState {
    order: Rec
    terminal: Rec | null // settle / nofill / unresolved
  }
  const byOid = new Map<string, TradeState>()
  const starts: Rec[] = []
  let lastEventTs: number | null = null

  for (const d of recs) {
    const ts = finite(d.ts)
    if (ts != null) lastEventTs = ts
    switch (d.type) {
      case "start": {
        // 锚点必须有效才能参与权益计算（治伪造 $0 锚点/NaN 传播）
        const col = finite(d.collateral)
        const sTs = finite(d.ts)
        if (col != null && col > 0 && sTs != null && sTs > 0) starts.push(d)
        else alarms.push(`malformed-start ts=${numSafe(d.ts)}`)
        break
      }
      case "order": {
        if (typeof d.oid !== "string") {
          alarms.push(`order-missing-oid w=${numSafe(d.w)}`)
          break
        }
        if (byOid.has(d.oid)) alarms.push(`duplicate-order oid=${oidShort(d.oid)}`)
        else byOid.set(d.oid, { order: d, terminal: null })
        break
      }
      case "settle":
      case "nofill":
      case "unresolved": {
        const st = typeof d.oid === "string" ? byOid.get(d.oid) : undefined
        if (!st) {
          alarms.push(`orphan-${d.type} oid=${oidShort(d.oid)} w=${numSafe(d.w)}`)
          break
        }
        if (st.terminal) alarms.push(`terminal-conflict oid=${oidShort(d.oid)}`)
        else st.terminal = d
        break
      }
      case "order_error":
        alarms.push(`order-error w=${numSafe(d.w)}`)
        break
      default:
        break // start/end/未知类型不参与
    }
  }

  // ---- 逐单结算口径 ----
  const windows = new Set<number>()
  for (const { order } of byOid.values()) if (typeof order.w === "number") windows.add(order.w)
  const simByW = collectSimN4(parseLines(paperLines), windows)

  interface Built {
    row: RealTradeRow
    ts: number // 权益事件时间（终态优先, 缺失回退下单时间）
    orderTs: number
    terminalTs: number | null
  }
  const built: Built[] = []

  for (const { order, terminal } of byOid.values()) {
    const oid = order.oid as string
    const limitPx = finite(order.px) ?? 0
    const orderTs = finite(order.ts) ?? 0
    const terminalTs = terminal ? finite(terminal.ts) : null
    let status: RealTradeStatus
    let lots: OwnedLot[] = []
    let fee: number | null = null
    let netPnl: number | null = null
    let matched: number | null = null

    if (!terminal) {
      status = "pending"
    } else if (terminal.type === "nofill") {
      status = "nofill"
    } else if (terminal.type === "unresolved") {
      status = "unresolved"
      alarms.push(`unresolved oid=${oidShort(oid)} w=${numSafe(order.w)}`)
    } else {
      // settle: matched/won 必须是合法值, 否则整单降级 uncertain（治 NaN 进权威合计）
      matched = finite(terminal.matched)
      const won = terminal.won
      if (matched == null || matched <= 0 || typeof won !== "boolean") {
        status = "uncertain"
        matched = null
        alarms.push(`malformed-settle oid=${oidShort(oid)} w=${numSafe(order.w)}`)
      } else {
        lots = ownedLots(terminal.fills_sample, oid)
        const ownedSize = lots.reduce((a, l) => a + l.size, 0)
        if (!lots.length || Math.abs(ownedSize - matched) > 0.01) {
          status = "uncertain"
          alarms.push(`uncertain-evidence oid=${oidShort(oid)} w=${numSafe(order.w)}`)
        } else {
          status = won ? "won" : "lost"
          fee = lots.reduce((a, l) => a + (l.maker ? 0 : takerFee(l.px, l.size)), 0)
          const cost = lots.reduce((a, l) => a + l.px * l.size, 0)
          netPnl = (won ? matched - cost : -cost) - fee
        }
      }
    }

    const certain = status === "won" || status === "lost"
    const fillPxAvg =
      certain && matched ? lots.reduce((a, l) => a + l.px * l.size, 0) / matched : null
    const makerRatio =
      certain && matched ? lots.reduce((a, l) => a + (l.maker ? l.size : 0), 0) / matched : null

    // ---- 模拟盘配对（era 严格: v3 时代只认 exec:3, 更早一律 era-mismatch） ----
    // 配对基准是 paper N4;带 strategy 标签且非 N4 的实盘单(如 C1 探针)不可比,
    // 直接跳过配对,避免假 side/px 背离标签 [Codex#8 2026-07-12]
    const stratTag = typeof order.strategy === "string" ? order.strategy : null
    const simRec = stratTag && stratTag !== "N4" ? undefined : simByW.get(order.w as number)
    let sim: RealTradeRow["sim"] = { kind: "none" }
    let simDivergence: RealTradeRow["simDivergence"] = null
    const v3Era = orderTs >= EXEC_V3_SINCE
    const realFilled = certain || status === "uncertain"
    const centsGap = (a: number, b: number) => Math.round(Math.abs(a - b) * 100)
    if (simRec) {
      if (!v3Era) {
        // 侦察时代: 有任何 N4 记录都不可比
        if (simRec.entry3 || simRec.miss3 || simRec.legacy) sim = { kind: "era-mismatch" }
      } else if (simRec.entry3) {
        sim = { kind: "entry", px: simRec.entry3.px, won: simRec.won }
        if (simRec.entry3.sideUp !== Boolean(order.side_up)) simDivergence = "side-mismatch"
        else if (fillPxAvg != null)
          simDivergence = centsGap(simRec.entry3.px, fillPxAvg) <= 1 ? "match" : "px-gap"
        else if (status === "uncertain")
          // 仅 uncertain 用挂价退化比较（UI 标 ~）; pending/nofill/unresolved 不下配对结论
          simDivergence = centsGap(simRec.entry3.px, limitPx) <= 1 ? "match" : "px-gap"
      } else if (simRec.miss3) {
        sim = { kind: "miss", missReason: simRec.miss3.reason }
        // 只有实盘确实成交了, "模拟 miss" 才构成背离
        if (realFilled) simDivergence = "sim-missed"
      } else if (simRec.legacy) {
        sim = { kind: "era-mismatch" }
      }
    }

    built.push({
      row: {
        w: order.w,
        windowLabel: windowLabel(order.w),
        oid10: oidShort(oid),
        sideUp: Boolean(order.side_up),
        limitPx,
        status,
        lots,
        fillPxAvg,
        makerRatio,
        fee,
        matched,
        netPnl,
        postLatencyMs: finite(order.latency_ms),
        disp: finite(order.disp),
        sim,
        simDivergence,
      },
      ts: terminalTs ?? orderTs,
      orderTs,
      terminalTs,
    })
  }

  // ---- 权益曲线（已实现口径）+ start 检查点 ----
  const hasTrades = byOid.size > 0
  const balanceStart = starts.length ? (finite(starts[0].collateral) as number) : 0
  if (!starts.length && hasTrades) alarms.push("missing-anchor")

  type EquityEvent = { ts: number; delta: number }
  const events: EquityEvent[] = built
    .filter((b) => b.row.netPnl != null)
    .map((b) => ({ ts: b.ts, delta: b.row.netPnl as number }))
    .sort((a, b) => a.ts - b.ts)

  const equity: { ts: number; balance: number }[] = []
  if (starts.length) {
    let bal = balanceStart
    equity.push({ ts: finite(starts[0].ts) as number, balance: bal })
    for (const e of events) {
      bal += e.delta
      equity.push({ ts: e.ts, balance: bal })
    }
  }

  // start 检查点: 只在"该时点"所有先前单都已 certain 落定时才有资格校验
  // （治用最终状态误判检查点时点状态 → 假漂移告警）
  for (let i = 1; i < starts.length; i++) {
    const sTs = finite(starts[i].ts) as number
    const openAtCheckpoint = built.some(
      (b) =>
        b.orderTs < sTs &&
        (b.terminalTs == null ||
          b.terminalTs >= sTs ||
          b.row.status === "uncertain" ||
          b.row.status === "unresolved"),
    )
    if (openAtCheckpoint) continue
    const expected =
      balanceStart + events.filter((e) => e.ts <= sTs).reduce((a, e) => a + e.delta, 0)
    const col = finite(starts[i].collateral) as number
    if (Math.abs(col - expected) > 0.01) alarms.push(`checkpoint-drift ts=${sTs}`)
  }

  // ---- 汇总 ----
  const rows = built.sort((a, b) => (b.row.w as number) - (a.row.w as number)).map((b) => b.row)
  const netTotal = events.reduce((a, e) => a + e.delta, 0)
  const wins = rows.filter((r) => r.status === "won").length
  const losses = rows.filter((r) => r.status === "lost").length
  const nofills = rows.filter((r) => r.status === "nofill").length
  const pendingCount = rows.filter((r) => r.status === "pending").length
  const uncertainCount = rows.filter((r) => r.status === "uncertain").length

  // openCostBound: pending 单尚无成交证据, 用账本 order.notional(限价×股数)做占用上界
  let openBound = 0
  for (const { order, terminal } of byOid.values()) {
    if (terminal) continue
    const n = finite(order.notional)
    if (n != null && n > 0) openBound += n
    else alarms.push(`malformed-notional oid=${oidShort(order.oid)}`)
  }

  const certainLots = rows
    .filter((r) => r.status === "won" || r.status === "lost")
    .flatMap((r) => r.lots)
  const lotSize = certainLots.reduce((a, l) => a + l.size, 0)
  const makerLotRatio =
    lotSize > 0 ? certainLots.reduce((a, l) => a + (l.maker ? l.size : 0), 0) / lotSize : null

  // ---- 批次（最新 start 为锚） ----
  let batch: PmScalpRealSnapshot["batch"] = null
  if (starts.length) {
    const anchor = starts[starts.length - 1]
    const caps = anchor.caps ?? {}
    const anchorTs = finite(anchor.ts) as number
    const capTrades = finite(caps.max_trades) ?? 0
    const resumed = finite(anchor.resumed_trades) ?? 0
    const inBatch = built.filter((b) => b.orderTs >= anchorTs)
    batch = {
      anchorTs,
      capTrades,
      capNotional: finite(caps.max_notional) ?? 0,
      resumed,
      denominator: Math.max(0, capTrades - resumed),
      done: inBatch.length,
      pending: inBatch.filter((b) => b.row.status === "pending").length,
    }
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    running: opts.running,
    lastEventAgeSeconds:
      lastEventTs != null ? Math.max(0, Math.round(opts.nowSec - lastEventTs)) : null,
    batch,
    balanceStart,
    realizedEquity: balanceStart + netTotal,
    openCostBound: openBound,
    uncertainCount,
    netTotal,
    wins,
    losses,
    nofills,
    pending: pendingCount,
    makerLotRatio,
    equity,
    trades: rows,
    alarms,
  }
}

/** 白名单文件读取: 存在且是普通文件(拒 symlink)才读 */
async function readWhitelisted(p: string): Promise<string | null> {
  try {
    const st = await fs.lstat(p)
    if (!st.isFile()) return null
    return await fs.readFile(p, "utf8")
  } catch {
    return null
  }
}

export async function readPmScalpRealSnapshot(): Promise<PmScalpRealSnapshot> {
  const dir = scalpDir()
  const [ledger, paper, pid] = await Promise.all([
    readWhitelisted(path.join(dir, "real", "recon-ledger.jsonl")),
    readWhitelisted(path.join(dir, "paper", "trades.jsonl")),
    fs
      .lstat(path.join(dir, "real", "recon.pid"))
      .then((st) => st.isFile())
      .catch(() => false),
  ])
  return buildRealSnapshot(
    ledger ? ledger.split("\n") : [],
    paper ? paper.split("\n") : [],
    { running: pid, nowSec: Date.now() / 1000 },
  )
}
