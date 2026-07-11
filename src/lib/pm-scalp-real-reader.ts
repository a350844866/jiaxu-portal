/**
 * pm-scalp 实盘（recon.py 真金账本）state reader。
 *
 * 与 pm-scalp-reader.ts（模拟盘）刻意分离：实盘是金融记录，口径以
 * docs/superpowers/specs/2026-07-11-pm-scalp-live-dashboard-design.md 为权威
 * （Codex design review 10 条已吸收）。核心是纯函数 buildRealSnapshot——
 * fs 壳只负责读三个白名单文件，所有会算错钱的逻辑都可单测直打。
 *
 * 白名单（绝不读 real/.env、real/derived-creds.json）：
 *   real/recon-ledger.jsonl — append-only 账本 {type:start|order|settle|nofill|unresolved|order_error|end}
 *   real/recon.pid          — 存在即 recon 运行中（进程收尾/退出时删除）
 *   paper/trades.jsonl      — 仅取 N4 记录做同窗配对
 *
 * 对账口径（2026-07-11 实盘 7 单逐单对平链上余额验证）：
 *   - fill 所有权：fill.taker_order_id === 我方 oid → taker lot（价=fill.price）；
 *     否则扫 maker_orders[].order_id === 我方 oid → maker lot（价=m.price）。
 *     顶层 trader_side 在 maker 成交时描述的是对手聚合事件，不可用作我方角色。
 *   - 费：taker lot Σ 0.07·px·(1−px)·size；maker lot 零费。
 *   - 证据不全（|Σ owned − matched| > 0.01）→ uncertain，排除出一切权威合计。
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

/** 从 fills_sample 提取我方 lots；返回 null 表示证据缺失/不属于我方 */
function ownedLots(fills: unknown, oid: string): OwnedLot[] {
  const lots: OwnedLot[] = []
  if (!Array.isArray(fills)) return lots
  for (const f of fills as Rec[]) {
    if (!f || typeof f !== "object") continue
    if (f.taker_order_id === oid) {
      const px = Number(f.price)
      const size = Number(f.size)
      if (Number.isFinite(px) && Number.isFinite(size) && px > 0 && size > 0)
        lots.push({ px, size, maker: false })
      continue
    }
    for (const m of Array.isArray(f.maker_orders) ? (f.maker_orders as Rec[]) : []) {
      if (m && m.order_id === oid) {
        const px = Number(m.price)
        const size = Number(m.matched_amount)
        if (Number.isFinite(px) && Number.isFinite(size) && px > 0 && size > 0)
          lots.push({ px, size, maker: true })
      }
    }
  }
  return lots
}

const takerFee = (px: number, size: number) => 0.07 * px * (1 - px) * size

interface SimN4 {
  entry?: { px: number; sideUp: boolean; exec: number }
  miss?: { reason: string; exec: number }
  won?: boolean
}

function collectSimN4(paperRecs: Rec[], windows: Set<number>): Map<number, SimN4> {
  const byW = new Map<number, SimN4>()
  for (const d of paperRecs) {
    if (d.v !== "N4" || typeof d.w !== "number" || !windows.has(d.w)) continue
    const cur = byW.get(d.w) ?? {}
    if (d.type === "entry" && cur.entry === undefined) {
      cur.entry = { px: Number(d.px), sideUp: Boolean(d.side_up), exec: Number(d.exec ?? 0) }
    } else if (d.type === "miss" && cur.miss === undefined) {
      cur.miss = { reason: String(d.reason ?? "?"), exec: Number(d.exec ?? 0) }
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
    if (typeof d.ts === "number") lastEventTs = d.ts
    switch (d.type) {
      case "start":
        starts.push(d)
        break
      case "order": {
        if (typeof d.oid !== "string") {
          alarms.push(`order-missing-oid w=${d.w ?? "?"}`)
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
          alarms.push(`orphan-${d.type} oid=${oidShort(d.oid)} w=${d.w ?? "?"}`)
          break
        }
        if (st.terminal) alarms.push(`terminal-conflict oid=${oidShort(d.oid)}`)
        else st.terminal = d
        break
      }
      case "order_error":
        alarms.push(`order-error w=${d.w ?? "?"}`)
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
    ts: number // 终态或下单时间, 用于 equity 排序
    orderTs: number
  }
  const built: Built[] = []

  for (const { order, terminal } of byOid.values()) {
    const oid = order.oid as string
    const limitPx = Number(order.px)
    const orderTs = Number(order.ts ?? 0)
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
      alarms.push(`unresolved oid=${oidShort(oid)} w=${order.w}`)
    } else {
      // settle
      matched = Number(terminal.matched ?? 0)
      lots = ownedLots(terminal.fills_sample, oid)
      const ownedSize = lots.reduce((a, l) => a + l.size, 0)
      if (!lots.length || Math.abs(ownedSize - matched) > 0.01) {
        status = "uncertain"
        alarms.push(`uncertain-evidence oid=${oidShort(oid)} w=${order.w}`)
      } else {
        status = terminal.won ? "won" : "lost"
        fee = lots.reduce((a, l) => a + (l.maker ? 0 : takerFee(l.px, l.size)), 0)
        const cost = lots.reduce((a, l) => a + l.px * l.size, 0)
        netPnl = (terminal.won ? matched - cost : -cost) - fee
      }
    }

    const certain = status === "won" || status === "lost"
    const fillPxAvg =
      certain && matched ? lots.reduce((a, l) => a + l.px * l.size, 0) / matched : null
    const makerRatio =
      certain && matched ? lots.reduce((a, l) => a + (l.maker ? l.size : 0), 0) / matched : null

    // ---- 模拟盘配对 ----
    const simRec = simByW.get(order.w as number)
    let sim: RealTradeRow["sim"] = { kind: "none" }
    let simDivergence: RealTradeRow["simDivergence"] = null
    const v3Era = orderTs >= EXEC_V3_SINCE
    if (simRec?.entry) {
      if (!v3Era && simRec.entry.exec < 3) {
        sim = { kind: "era-mismatch" }
      } else {
        sim = { kind: "entry", px: simRec.entry.px, won: simRec.won }
        // 价差按"分"取整比较, 规避浮点毛刺(0.31-0.30 > 0.01)
        const centsGap = (a: number, b: number) => Math.round(Math.abs(a - b) * 100)
        if (simRec.entry.sideUp !== Boolean(order.side_up)) simDivergence = "side-mismatch"
        else if (fillPxAvg != null)
          simDivergence = centsGap(simRec.entry.px, fillPxAvg) <= 1 ? "match" : "px-gap"
        else if (certain === false)
          simDivergence = centsGap(simRec.entry.px, limitPx) <= 1 ? "match" : "px-gap"
      }
    } else if (simRec?.miss) {
      if (!v3Era && simRec.miss.exec < 3) sim = { kind: "era-mismatch" }
      else {
        sim = { kind: "miss", missReason: simRec.miss.reason }
        simDivergence = "sim-missed"
      }
    }

    built.push({
      row: {
        w: order.w,
        windowLabel: windowLabel(order.w),
        sideUp: Boolean(order.side_up),
        limitPx,
        status,
        lots,
        fillPxAvg,
        makerRatio,
        fee,
        matched,
        netPnl,
        postLatencyMs: typeof order.latency_ms === "number" ? order.latency_ms : null,
        disp: typeof order.disp === "number" ? order.disp : null,
        sim,
        simDivergence,
      },
      ts: Number(terminal?.ts ?? order.ts ?? 0),
      orderTs,
    })
  }

  // ---- 权益曲线（已实现口径）+ start 检查点 ----
  const balanceStart = starts.length ? Number(starts[0].collateral) : 0
  type EquityEvent = { ts: number; delta: number }
  const events: EquityEvent[] = built
    .filter((b) => b.row.netPnl != null)
    .map((b) => ({ ts: b.ts, delta: b.row.netPnl as number }))
    .sort((a, b) => a.ts - b.ts)

  const equity: { ts: number; balance: number }[] = []
  if (starts.length) {
    let bal = balanceStart
    equity.push({ ts: Number(starts[0].ts ?? 0), balance: bal })
    for (const e of events) {
      bal += e.delta
      equity.push({ ts: e.ts, balance: bal })
    }
  }

  // start 检查点：该时点前若无 pending/uncertain 且有锚点, 校验累计
  for (let i = 1; i < starts.length; i++) {
    const s = starts[i]
    const sTs = Number(s.ts ?? 0)
    const pendingBefore = built.some(
      (b) =>
        b.orderTs < sTs &&
        (b.row.status === "pending" || b.row.status === "uncertain" || b.row.status === "unresolved"),
    )
    if (pendingBefore) continue
    const expected =
      balanceStart + events.filter((e) => e.ts <= sTs).reduce((a, e) => a + e.delta, 0)
    if (Math.abs(Number(s.collateral) - expected) > 0.01)
      alarms.push(`checkpoint-drift ts=${sTs} ledger=${Number(s.collateral).toFixed(4)} expected=${expected.toFixed(4)}`)
  }

  // ---- 汇总 ----
  const rows = built.sort((a, b) => (b.row.w as number) - (a.row.w as number)).map((b) => b.row)
  const netTotal = events.reduce((a, e) => a + e.delta, 0)
  const wins = rows.filter((r) => r.status === "won").length
  const losses = rows.filter((r) => r.status === "lost").length
  const nofills = rows.filter((r) => r.status === "nofill").length
  const pendingRows = built.filter((b) => b.row.status === "pending")
  const uncertainCount = rows.filter((r) => r.status === "uncertain").length

  // openCostBound: pending 单尚无成交证据, 用账本 order.notional(限价×股数)做占用上界
  let openBound = 0
  for (const { order, terminal } of byOid.values()) {
    if (!terminal && typeof order.notional === "number") openBound += order.notional
  }

  const certainLots = rows.filter((r) => r.status === "won" || r.status === "lost").flatMap((r) => r.lots)
  const lotSize = certainLots.reduce((a, l) => a + l.size, 0)
  const makerLotRatio = lotSize > 0 ? certainLots.reduce((a, l) => a + (l.maker ? l.size : 0), 0) / lotSize : null

  // ---- 批次（最新 start 为锚） ----
  let batch: PmScalpRealSnapshot["batch"] = null
  if (starts.length) {
    const anchor = starts[starts.length - 1]
    const caps = anchor.caps ?? {}
    const anchorTs = Number(anchor.ts ?? 0)
    const capTrades = Number(caps.max_trades ?? 0)
    const resumed = Number(anchor.resumed_trades ?? 0)
    const inBatch = built.filter((b) => b.orderTs >= anchorTs)
    batch = {
      capTrades,
      capNotional: Number(caps.max_notional ?? 0),
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
    lastEventAgeSeconds: lastEventTs != null ? Math.max(0, Math.round(opts.nowSec - lastEventTs)) : null,
    batch,
    balanceStart,
    realizedEquity: balanceStart + netTotal,
    openCostBound: openBound,
    uncertainCount,
    netTotal,
    wins,
    losses,
    nofills,
    pending: pendingRows.length,
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
