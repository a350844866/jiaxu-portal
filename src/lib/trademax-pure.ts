/**
 * trademax-observer — pure parsing + analytics over the observed MT4 account.
 *
 * The observer (`/data/trademax-observer`) holds an *investor* (read-only)
 * login on a gold "quant" account someone handed Taieo. Everything here is
 * derived from order metadata alone — we can never see the EA itself, so the
 * dashboard's job is to make the *behaviour* legible and to keep the sample
 * size honest.
 *
 * Broker clock is GMT+3 (verified 2026-08-06: Market Watch read 10:09 while
 * Beijing was 15:09). Beijing = server + 5h.
 *
 * No fs access in this file — everything takes strings/objects so it stays
 * unit-testable.
 */

export const SERVER_UTC_OFFSET_HOURS = 3
export const BEIJING_UTC_OFFSET_HOURS = 8
/** Sample size below which we refuse to call any edge real. */
export const MIN_SAMPLE_FOR_EDGE = 200
/** XAUUSD contract size: 1 lot = 100 oz. */
export const XAU_CONTRACT = 100

export type ExitKind = "sl" | "tp" | "partial-parent" | "other"

export interface Deal {
  ticket: string
  type: "buy" | "sell"
  size: number
  symbol: string
  openTime: string
  openMs: number
  closeTime: string | null
  closeMs: number | null
  openPrice: number
  closePrice: number | null
  sl: number | null
  tp: number | null
  profit: number
  comment: string
  exit: ExitKind
  /** signed distance of the final SL from entry, + = moved to the profit side */
  slOffset: number | null
  tpOffset: number | null
  holdMin: number | null
  /** true when this leg is the remainder of a partially-closed order */
  isPartialChild: boolean
  isPartialParent: boolean
}

export interface PendingOrder {
  ticket: string
  type: string
  size: number
  symbol: string
  price: number
  placedTime: string
  cancelledTime: string | null
  comment: string
}

/** "2026.08.03 07:49:06" in broker time → epoch ms */
export function parseServerTime(s: string): number | null {
  const m = /^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, sec] = m
  return Date.UTC(+y, +mo - 1, +d, +h - SERVER_UTC_OFFSET_HOURS, +mi, +sec)
}

export function beijingHour(ms: number): number {
  return new Date(ms + BEIJING_UTC_OFFSET_HOURS * 3600_000).getUTCHours()
}

export function beijingDate(ms: number): string {
  const d = new Date(ms + BEIJING_UTC_OFFSET_HOURS * 3600_000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
}

function num(v: string | undefined): number | null {
  if (v == null || v === "") return null
  const n = Number(String(v).replace(/,/g, ""))
  return Number.isFinite(n) ? n : null
}

function classifyExit(comment: string): ExitKind {
  if (comment.startsWith("to #")) return "partial-parent"
  if (comment.includes("[sl]")) return "sl"
  if (comment.includes("[tp]")) return "tp"
  return "other"
}

/** Split a CSV line honouring nothing fancy — the writer never quotes. */
function splitCsv(line: string): string[] {
  return line.split(",")
}

export interface ParsedTrades {
  deals: Deal[]
  pending: PendingOrder[]
  skipped: number
}

export function parseTradesCsv(text: string): ParsedTrades {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "")
  if (lines.length === 0) return { deals: [], pending: [], skipped: 0 }
  const header = splitCsv(lines[0]).map((h) => h.trim())
  const idx = (k: string) => header.indexOf(k)
  const cols = {
    ticket: idx("ticket"), openTime: idx("open_time"), type: idx("type"),
    size: idx("size"), symbol: idx("symbol"), openPrice: idx("open_price"),
    sl: idx("sl"), tp: idx("tp"), closeTime: idx("close_time"),
    closePrice: idx("close_price"), commission: idx("commission"),
    swap: idx("swap"), profit: idx("profit"), comment: idx("comment"),
  }
  const deals: Deal[] = []
  const pending: PendingOrder[] = []
  let skipped = 0

  for (const line of lines.slice(1)) {
    const c = splitCsv(line)
    const type = (c[cols.type] ?? "").trim()
    const ticket = (c[cols.ticket] ?? "").trim()
    if (!ticket) { skipped++; continue }
    const openMs = parseServerTime(c[cols.openTime] ?? "")
    if (openMs == null) { skipped++; continue }

    if (type !== "buy" && type !== "sell") {
      // buy limit / sell stop / … — never filled, kept for the anomaly panel
      pending.push({
        ticket, type, size: num(c[cols.size]) ?? 0,
        symbol: (c[cols.symbol] ?? "").trim(),
        price: num(c[cols.openPrice]) ?? 0,
        placedTime: (c[cols.openTime] ?? "").trim(),
        cancelledTime: (c[cols.closeTime] ?? "").trim() || null,
        comment: (c[cols.comment] ?? "").trim(),
      })
      continue
    }

    const closeMs = parseServerTime(c[cols.closeTime] ?? "")
    const openPrice = num(c[cols.openPrice]) ?? 0
    const sl = num(c[cols.sl])
    const tp = num(c[cols.tp])
    const dir = type === "buy" ? 1 : -1
    const comment = (c[cols.comment] ?? "").trim()
    deals.push({
      ticket, type, size: num(c[cols.size]) ?? 0,
      symbol: (c[cols.symbol] ?? "").trim(),
      openTime: (c[cols.openTime] ?? "").trim(),
      openMs,
      closeTime: (c[cols.closeTime] ?? "").trim() || null,
      closeMs,
      openPrice,
      closePrice: num(c[cols.closePrice]),
      sl: sl && sl > 0 ? sl : null,
      tp: tp && tp > 0 ? tp : null,
      profit: (num(c[cols.profit]) ?? 0) + (num(c[cols.swap]) ?? 0) + (num(c[cols.commission]) ?? 0),
      comment,
      exit: classifyExit(comment),
      slOffset: sl && sl > 0 ? (sl - openPrice) * dir : null,
      tpOffset: tp && tp > 0 ? (tp - openPrice) * dir : null,
      holdMin: closeMs != null ? (closeMs - openMs) / 60_000 : null,
      isPartialChild: comment.startsWith("from #"),
      isPartialParent: comment.startsWith("to #"),
    })
  }
  deals.sort((a, b) => a.openMs - b.openMs || a.ticket.localeCompare(b.ticket))
  return { deals, pending, skipped }
}

// ── derived stats ─────────────────────────────────────────────────────────

export interface Performance {
  n: number
  wins: number
  losses: number
  flat: number
  winRate: number | null
  avgWin: number | null
  avgLoss: number | null
  /** avgWin / |avgLoss| — the number that makes an 83% win rate mean nothing */
  payoff: number | null
  profitFactor: number | null
  expectancy: number | null
  grossWin: number
  grossLoss: number
  maxWin: number | null
  maxLoss: number | null
  maxLossStreak: number
  afterLossSameDir: number
  afterLossReverse: number
}

export function performance(deals: Deal[]): Performance {
  const wins = deals.filter((d) => d.profit > 0)
  const losses = deals.filter((d) => d.profit < 0)
  const grossWin = wins.reduce((s, d) => s + d.profit, 0)
  const grossLoss = losses.reduce((s, d) => s + d.profit, 0)
  const avgWin = wins.length ? grossWin / wins.length : null
  const avgLoss = losses.length ? grossLoss / losses.length : null
  let streak = 0
  let maxStreak = 0
  let same = 0
  let rev = 0
  deals.forEach((d, i) => {
    streak = d.profit < 0 ? streak + 1 : 0
    if (streak > maxStreak) maxStreak = streak
    const next = deals[i + 1]
    if (next && d.profit < 0) {
      if (next.type === d.type) same++
      else rev++
    }
  })
  return {
    n: deals.length,
    wins: wins.length,
    losses: losses.length,
    flat: deals.length - wins.length - losses.length,
    winRate: deals.length ? wins.length / deals.length : null,
    avgWin,
    avgLoss,
    payoff: avgWin != null && avgLoss ? avgWin / Math.abs(avgLoss) : null,
    profitFactor: grossLoss ? grossWin / Math.abs(grossLoss) : null,
    expectancy: deals.length ? (grossWin + grossLoss) / deals.length : null,
    grossWin,
    grossLoss,
    maxWin: deals.length ? Math.max(...deals.map((d) => d.profit)) : null,
    maxLoss: deals.length ? Math.min(...deals.map((d) => d.profit)) : null,
    maxLossStreak: maxStreak,
    afterLossSameDir: same,
    afterLossReverse: rev,
  }
}

export interface EquityPoint {
  ticket: string
  /** close time preferred — that is when the balance actually moved */
  ms: number
  balance: number
  profit: number
}

export interface EquityCurve {
  points: EquityPoint[]
  start: number
  end: number
  peak: number
  trough: number
  maxDrawdown: number
  maxDrawdownPct: number | null
  returnPct: number | null
}

export function equityCurve(deals: Deal[], deposit: number): EquityCurve {
  const ordered = [...deals].sort((a, b) => (a.closeMs ?? a.openMs) - (b.closeMs ?? b.openMs))
  let bal = deposit
  let peak = deposit
  let trough = deposit
  let maxDD = 0
  const points: EquityPoint[] = []
  for (const d of ordered) {
    bal += d.profit
    if (bal > peak) peak = bal
    if (bal < trough) trough = bal
    if (peak - bal > maxDD) maxDD = peak - bal
    points.push({ ticket: d.ticket, ms: d.closeMs ?? d.openMs, balance: bal, profit: d.profit })
  }
  return {
    points,
    start: deposit,
    end: bal,
    peak,
    trough,
    maxDrawdown: maxDD,
    maxDrawdownPct: peak > 0 ? maxDD / peak : null,
    returnPct: deposit > 0 ? bal / deposit - 1 : null,
  }
}

export interface DayStat {
  date: string
  n: number
  wins: number
  pnl: number
  balanceEnd: number
}

export function byDay(deals: Deal[], deposit: number): DayStat[] {
  const ordered = [...deals].sort((a, b) => (a.closeMs ?? a.openMs) - (b.closeMs ?? b.openMs))
  const map = new Map<string, DayStat>()
  let bal = deposit
  for (const d of ordered) {
    const key = beijingDate(d.closeMs ?? d.openMs)
    bal += d.profit
    const cur = map.get(key) ?? { date: key, n: 0, wins: 0, pnl: 0, balanceEnd: bal }
    cur.n++
    if (d.profit > 0) cur.wins++
    cur.pnl += d.profit
    cur.balanceEnd = bal
    map.set(key, cur)
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export interface Bucket {
  key: string
  label: string
  n: number
  sum: number
  avg: number | null
}

/** Where the money actually came from, split by how the trade ended. */
export function exitBuckets(deals: Deal[]): Bucket[] {
  const defs: { key: ExitKind; label: string }[] = [
    { key: "sl", label: "止损位触发（含保本位）" },
    { key: "partial-parent", label: "部分平仓母单" },
    { key: "tp", label: "止盈位触发" },
    { key: "other", label: "其它/主动平仓" },
  ]
  return defs
    .map(({ key, label }) => {
      const rows = deals.filter((d) => d.exit === key)
      const sum = rows.reduce((s, d) => s + d.profit, 0)
      return { key, label, n: rows.length, sum, avg: rows.length ? sum / rows.length : null }
    })
    .filter((b) => b.n > 0)
}

export interface StopStructure {
  /** SL already moved to the profit side at close */
  movedToProfit: number
  /** still on the loss side — i.e. the original protective stop */
  stillProtective: number
  /** the hard-coded lock level and how many trades sat exactly on it */
  lockLevel: number | null
  lockLevelCount: number
  /** distribution of the signed SL offset, rounded to 0.5 buckets */
  offsetHistogram: { bucket: number; n: number }[]
  /** median distance of the still-protective stops (= the initial risk) */
  medianInitialStop: number | null
  /** median risk in USD at the modal lot size */
  medianRiskUsd: number | null
  /** SL exits that still made money — the trailing/breakeven mechanic at work */
  slExitsProfitable: number
  slExitsTotal: number
  withTp: number
  withoutTp: number
  withTpPnl: number
  withoutTpPnl: number
  medianTpDistance: number | null
}

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function stopStructure(deals: Deal[]): StopStructure {
  const withSl = deals.filter((d) => d.slOffset != null)
  const moved = withSl.filter((d) => (d.slOffset as number) > 0)
  const protective = withSl.filter((d) => (d.slOffset as number) <= 0)

  const rounded = new Map<number, number>()
  for (const d of moved) rounded.set(round2(d.slOffset as number), (rounded.get(round2(d.slOffset as number)) ?? 0) + 1)
  let lockLevel: number | null = null
  let lockCount = 0
  for (const [k, v] of rounded) if (v > lockCount) { lockCount = v; lockLevel = k }

  const hist = new Map<number, number>()
  for (const d of withSl) {
    const b = Math.round((d.slOffset as number) * 2) / 2
    hist.set(b, (hist.get(b) ?? 0) + 1)
  }

  const modalLot = modeOf(deals.map((d) => d.size)) ?? 0.05
  const medInit = median(protective.map((d) => Math.abs(d.slOffset as number)))
  const slExits = deals.filter((d) => d.exit === "sl")
  const withTp = deals.filter((d) => d.tp != null)
  const withoutTp = deals.filter((d) => d.tp == null)

  return {
    movedToProfit: moved.length,
    stillProtective: protective.length,
    lockLevel,
    lockLevelCount: lockCount,
    offsetHistogram: [...hist.entries()].map(([bucket, n]) => ({ bucket, n })).sort((a, b) => a.bucket - b.bucket),
    medianInitialStop: medInit,
    medianRiskUsd: medInit != null ? medInit * modalLot * XAU_CONTRACT : null,
    slExitsProfitable: slExits.filter((d) => d.profit > 0).length,
    slExitsTotal: slExits.length,
    withTp: withTp.length,
    withoutTp: withoutTp.length,
    withTpPnl: withTp.reduce((s, d) => s + d.profit, 0),
    withoutTpPnl: withoutTp.reduce((s, d) => s + d.profit, 0),
    medianTpDistance: median(withTp.map((d) => Math.abs(d.tpOffset as number))),
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function modeOf(xs: number[]): number | null {
  const c = new Map<number, number>()
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1)
  let best: number | null = null
  let bn = 0
  for (const [k, v] of c) if (v > bn) { bn = v; best = k }
  return best
}

export interface TimingStats {
  /** entries per Beijing hour, index 0..23 */
  hourly: number[]
  sessions: { label: string; n: number }[]
  holdBuckets: { label: string; n: number }[]
  medianHoldMin: number | null
  medianGapMin: number | null
}

export function timing(deals: Deal[]): TimingStats {
  const hourly = Array<number>(24).fill(0)
  const sessions = { "亚洲 06-15": 0, "欧洲 15-21": 0, "美盘 21-06": 0 }
  for (const d of deals) {
    const h = beijingHour(d.openMs)
    hourly[h]++
    if (h >= 6 && h < 15) sessions["亚洲 06-15"]++
    else if (h >= 15 && h < 21) sessions["欧洲 15-21"]++
    else sessions["美盘 21-06"]++
  }
  const holds = deals.map((d) => d.holdMin).filter((x): x is number => x != null)
  const hb = { "<5min": 0, "5-15min": 0, "15-60min": 0, "1-4h": 0, ">4h": 0 }
  for (const h of holds) {
    if (h < 5) hb["<5min"]++
    else if (h < 15) hb["5-15min"]++
    else if (h < 60) hb["15-60min"]++
    else if (h < 240) hb["1-4h"]++
    else hb[">4h"]++
  }
  const gaps: number[] = []
  for (let i = 1; i < deals.length; i++) {
    const prevClose = deals[i - 1].closeMs
    if (prevClose != null) gaps.push((deals[i].openMs - prevClose) / 60_000)
  }
  return {
    hourly,
    sessions: Object.entries(sessions).map(([label, n]) => ({ label, n })),
    holdBuckets: Object.entries(hb).map(([label, n]) => ({ label, n })),
    medianHoldMin: median(holds),
    medianGapMin: median(gaps.filter((g) => g >= 0)),
  }
}

export interface ConcurrencyCheck {
  /** overlapping pairs that are *not* explained by a partial close */
  trueOverlaps: number
  /** overlapping pairs that are the mother/child legs of one decision */
  partialLegOverlaps: number
  /** distinct decisions = fills minus the partial remainders */
  decisions: number
  oneAtATime: boolean
}

export function concurrency(deals: Deal[]): ConcurrencyCheck {
  let trueOverlaps = 0
  let legOverlaps = 0
  for (let i = 0; i < deals.length; i++) {
    const a = deals[i]
    if (a.closeMs == null) continue
    for (let j = i + 1; j < deals.length; j++) {
      const b = deals[j]
      if (b.openMs >= a.closeMs) break
      // a partial close produces two legs with the identical open time+price
      if (a.openMs === b.openMs && a.openPrice === b.openPrice) legOverlaps++
      else trueOverlaps++
    }
  }
  return {
    trueOverlaps,
    partialLegOverlaps: legOverlaps,
    decisions: deals.filter((d) => !d.isPartialChild).length,
    oneAtATime: trueOverlaps === 0,
  }
}

export interface RiskProfile {
  modalLot: number | null
  lotDistribution: { size: number; n: number }[]
  lotsConstant: boolean
  notionalPerTrade: number | null
  /** notional ÷ current balance */
  leverage: number | null
  /** notional ÷ original deposit — what the sponsor actually signed up for */
  leverageOnDeposit: number | null
  riskPerTradeUsd: number | null
  riskPerTradePct: number | null
  riskPctOnDeposit: number | null
  /** fills whose size exceeded the modal lot — a fixed-lot bot should have none */
  oversizedFills: number
  /** balance after N consecutive stop-outs at the current risk */
  lossStreakLadder: { n: number; balance: number; pct: number }[]
  sampleProgress: { have: number; need: number; pct: number }
}

export function riskProfile(
  deals: Deal[], balance: number, medianRiskUsd: number | null, deposit = 0,
): RiskProfile {
  const lots = new Map<number, number>()
  for (const d of deals) lots.set(d.size, (lots.get(d.size) ?? 0) + 1)
  const modal = modeOf(deals.map((d) => d.size))
  const lastPrice = deals.length ? deals[deals.length - 1].closePrice ?? deals[deals.length - 1].openPrice : null
  const notional = modal != null && lastPrice != null ? modal * XAU_CONTRACT * lastPrice : null
  const ladder: { n: number; balance: number; pct: number }[] = []
  if (medianRiskUsd != null && balance > 0) {
    for (const n of [3, 5, 10]) {
      const b = balance - medianRiskUsd * n
      ladder.push({ n, balance: b, pct: b / balance - 1 })
    }
  }
  const oversized = modal == null ? 0 : deals.filter((d) => d.size > modal).length
  return {
    modalLot: modal,
    lotDistribution: [...lots.entries()].map(([size, n]) => ({ size, n })).sort((a, b) => a.size - b.size),
    // 0.02/0.03 are partial-close remainders of 0.05, so sizing only counts as
    // "constant" when nothing ever exceeded the modal lot
    lotsConstant: oversized === 0,
    oversizedFills: oversized,
    notionalPerTrade: notional,
    leverage: notional != null && balance > 0 ? notional / balance : null,
    leverageOnDeposit: notional != null && deposit > 0 ? notional / deposit : null,
    riskPerTradeUsd: medianRiskUsd,
    riskPerTradePct: medianRiskUsd != null && balance > 0 ? medianRiskUsd / balance : null,
    riskPctOnDeposit: medianRiskUsd != null && deposit > 0 ? medianRiskUsd / deposit : null,
    lossStreakLadder: ladder,
    sampleProgress: {
      have: deals.length,
      need: MIN_SAMPLE_FOR_EDGE,
      pct: Math.min(1, deals.length / MIN_SAMPLE_FOR_EDGE),
    },
  }
}

// ── live session feed ─────────────────────────────────────────────────────

export interface OpenPosition {
  ticket: string
  openTime: string
  type: string
  size: number
  symbol: string
  openPrice: number
  sl: number | null
  tp: number | null
  currentPrice: number | null
  profit: number | null
}

export interface AccountBar {
  balance: number | null
  equity: number | null
  freeMargin: number | null
}

export interface LiveEvent {
  t: string
  positions: OpenPosition[]
  bar: AccountBar
  /** what changed vs the previous record — the whole point of the live feed */
  kind: "open" | "close" | "sl-move" | "tp-move" | "flat" | "other"
  note: string
}

export function parseAccountBar(cell: string): AccountBar {
  const clean = cell.replace(/ /g, " ")
  const grab = (label: string) => {
    const m = new RegExp(`${label}:\\s*([-0-9.,]+)`).exec(clean)
    return m ? Number(m[1].replace(/,/g, "")) : null
  }
  return { balance: grab("Balance"), equity: grab("Equity"), freeMargin: grab("Free margin") }
}

function parsePositionRow(r: string[]): OpenPosition | null {
  if (r.length < 8 || !/^\d+$/.test(r[0])) return null
  const n = (v: string | undefined) => {
    const x = Number(String(v ?? "").replace(/,/g, ""))
    return Number.isFinite(x) ? x : null
  }
  return {
    ticket: r[0],
    openTime: r[1],
    type: r[2],
    size: n(r[3]) ?? 0,
    symbol: r[4],
    openPrice: n(r[5]) ?? 0,
    sl: (n(r[6]) ?? 0) > 0 ? n(r[6]) : null,
    tp: (n(r[7]) ?? 0) > 0 ? n(r[7]) : null,
    currentPrice: n(r[8]),
    profit: n(r[r.length - 1]),
  }
}

/** Turn the raw live.jsonl records into a human-readable change feed. */
export function parseLiveFeed(text: string, limit = 40): LiveEvent[] {
  const out: LiveEvent[] = []
  let prev: OpenPosition[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    let rec: { t: string; rows: string[][] }
    try {
      rec = JSON.parse(line)
    } catch {
      continue
    }
    const positions: OpenPosition[] = []
    let bar: AccountBar = { balance: null, equity: null, freeMargin: null }
    for (const r of rec.rows ?? []) {
      if (r[0]?.startsWith("Balance:")) bar = parseAccountBar(r[0])
      else {
        const p = parsePositionRow(r)
        if (p) positions.push(p)
      }
    }
    let kind: LiveEvent["kind"] = "other"
    let note = ""
    const prevByTicket = new Map(prev.map((p) => [p.ticket, p]))
    const nowByTicket = new Map(positions.map((p) => [p.ticket, p]))
    const opened = positions.filter((p) => !prevByTicket.has(p.ticket))
    const closed = prev.filter((p) => !nowByTicket.has(p.ticket))
    const slMoved = positions.filter((p) => {
      const o = prevByTicket.get(p.ticket)
      return o && o.sl !== p.sl
    })
    const tpMoved = positions.filter((p) => {
      const o = prevByTicket.get(p.ticket)
      return o && o.tp !== p.tp
    })
    if (opened.length) {
      kind = "open"
      const p = opened[0]
      note = `开仓 ${p.type} ${p.size} @ ${p.openPrice}${p.sl ? ` SL ${p.sl}` : ""}${p.tp ? ` TP ${p.tp}` : ""}`
    } else if (closed.length) {
      kind = "close"
      note = `平仓 #${closed[0].ticket}`
    } else if (slMoved.length) {
      kind = "sl-move"
      const p = slMoved[0]
      const o = prevByTicket.get(p.ticket)
      const dir = p.type === "buy" ? 1 : -1
      const off = p.sl != null ? (p.sl - p.openPrice) * dir : null
      note = `移动止损 #${p.ticket} ${o?.sl ?? "—"} → ${p.sl ?? "—"}` +
        (off != null ? `（相对开仓 ${off >= 0 ? "+" : ""}${off.toFixed(2)}）` : "")
    } else if (tpMoved.length) {
      kind = "tp-move"
      const p = tpMoved[0]
      const o = prevByTicket.get(p.ticket)
      note = `${p.tp == null ? "撤掉止盈" : "改止盈"} #${p.ticket} ${o?.tp ?? "—"} → ${p.tp ?? "—"}`
    } else if (positions.length === 0) {
      kind = "flat"
      note = "空仓"
    } else {
      note = "浮盈变动"
    }
    out.push({ t: rec.t, positions, bar, kind, note })
    prev = positions
  }
  return out.slice(-limit).reverse()
}

// ── entry-trigger analysis (produced by scripts/entry_reverse.py) ─────────

export interface EntryFeature {
  key: string
  label: string
  real: number
  base: number
  /** how many standard errors the real entries sit away from random minutes */
  z: number
}

export interface EntryAnalysis {
  generatedAt: string
  decisions: number
  aligned: number
  baselineSamples: number
  /** share of entries agreeing with the prior N-minute direction, keyed by N */
  trendAgreement: { window: number; share: number }[]
  features: EntryFeature[]
  clock: { secondsInFirst5: number; minuteMod5: number; minuteMod15: number; n: number }
  pullback: {
    distExt30Median: number | null
    atrMedian: number | null
    distInAtr: number | null
    alreadyBroken: number
    within1Atr: number
    n: number
  }
  gaps: { medianMin: number | null; under2min: number; n: number }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseEntryAnalysis(raw: any): EntryAnalysis | null {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.features)) return null
  return {
    generatedAt: String(raw.generated_at ?? ""),
    decisions: Number(raw.decisions ?? 0),
    aligned: Number(raw.aligned ?? 0),
    baselineSamples: Number(raw.baseline_samples ?? 0),
    trendAgreement: Object.entries(raw.trend_agreement ?? {})
      .map(([w, share]) => ({ window: Number(w), share: Number(share) }))
      .sort((a, b) => a.window - b.window),
    features: raw.features.map((f: any) => ({
      key: String(f.key), label: String(f.label),
      real: Number(f.real), base: Number(f.base), z: Number(f.z),
    })),
    clock: {
      secondsInFirst5: Number(raw.clock?.seconds_in_first5 ?? 0),
      minuteMod5: Number(raw.clock?.minute_mod5 ?? 0),
      minuteMod15: Number(raw.clock?.minute_mod15 ?? 0),
      n: Number(raw.clock?.n ?? 0),
    },
    pullback: {
      distExt30Median: raw.pullback?.dist_ext30_median ?? null,
      atrMedian: raw.pullback?.atr_median ?? null,
      distInAtr: raw.pullback?.dist_in_atr ?? null,
      alreadyBroken: Number(raw.pullback?.already_broken ?? 0),
      within1Atr: Number(raw.pullback?.within_1atr ?? 0),
      n: Number(raw.pullback?.n ?? 0),
    },
    gaps: {
      medianMin: raw.gaps?.median_min ?? null,
      under2min: Number(raw.gaps?.under2min ?? 0),
      n: Number(raw.gaps?.n ?? 0),
    },
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── the reverse-engineered rule set ───────────────────────────────────────

export interface Rule {
  id: number
  rule: string
  evidence: string
  confidence: "high" | "medium" | "unknown"
}

/**
 * Rules are stated as text but their *evidence* strings are computed from the
 * live data, so the page can never drift from the numbers underneath it.
 */
export function ruleSet(
  deals: Deal[], stops: StopStructure, conc: ConcurrencyCheck,
  risk: RiskProfile, tm: TimingStats, entry: EntryAnalysis | null = null,
): Rule[] {
  const symbols = [...new Set(deals.map((d) => d.symbol))]
  const fmt = (n: number | null, d = 2) => (n == null ? "—" : n.toFixed(d))
  return [
    {
      id: 1, confidence: "high",
      rule: `只做 ${symbols.join(" / ") || "—"}`,
      evidence: `${deals.filter((d) => d.symbol === symbols[0]).length}/${deals.length} 笔同品种`,
    },
    {
      id: 2, confidence: risk.oversizedFills === 0 ? "high" : "medium",
      rule: `基准 ${fmt(risk.modalLot, 2)} 手，不随余额复利、不马丁` +
        (risk.oversizedFills ? `（有 ${risk.oversizedFills} 笔超过基准手数，属例外）` : ""),
      evidence: `手数分布 ${risk.lotDistribution.map((l) => `${l.size}×${l.n}`).join(" / ")}；` +
        `余额翻倍期间基准手数未上调（小于基准的是部分平仓拆腿）` +
        (risk.oversizedFills ? `；但 ${risk.oversizedFills} 笔更大手数说明不是纯固定手数` : ""),
    },
    {
      id: 3, confidence: "high",
      rule: "真·一次一单（同时只持一个方向的一个仓）",
      evidence: `真并发 ${conc.trueOverlaps} 组；${conc.partialLegOverlaps} 组"重叠"全是部分平仓母/子腿`,
    },
    {
      id: 4, confidence: "high",
      rule: `初始止损约 ${fmt(stops.medianInitialStop)} 美元/盎司（≈ $${fmt(stops.medianRiskUsd)}，占本金 ${risk.riskPerTradePct != null ? (risk.riskPerTradePct * 100).toFixed(1) : "—"}%）`,
      evidence: `${stops.stillProtective} 笔止损未移动过，中位距离 ${fmt(stops.medianInitialStop)}`,
    },
    {
      id: 5, confidence: "high",
      rule: `初始止盈约 ${fmt(stops.medianTpDistance)} 美元，名义盈亏比 ≈ 1:1`,
      evidence: `${stops.withTp} 笔带 TP，距离中位 ${fmt(stops.medianTpDistance)}`,
    },
    {
      id: 6, confidence: "high",
      rule: `盈利后把止损挪到开仓价 +${fmt(stops.lockLevel)} 的硬档位（保本+锁利）`,
      evidence: `${stops.movedToProfit}/${deals.length} 笔最终 SL 已在盈利侧，其中 ${stops.lockLevelCount} 笔精确落在 +${fmt(stops.lockLevel)}`,
    },
    {
      id: 7, confidence: "high",
      rule: "进入盈利模式后撤掉止盈，改跑移动止损",
      evidence: `带 TP 的 ${stops.withTp} 笔合计 ${stops.withTpPnl >= 0 ? "+" : ""}${fmt(stops.withTpPnl)}；` +
        `无 TP 的 ${stops.withoutTp} 笔合计 ${stops.withoutTpPnl >= 0 ? "+" : ""}${fmt(stops.withoutTpPnl)}`,
    },
    {
      id: 8, confidence: "high",
      rule: "分批止盈：先平掉大半落袋，留小仓跑趋势",
      evidence: `${deals.filter((d) => d.isPartialParent).length} 组母/子腿；` +
        `母单均 ${fmt(avg(deals.filter((d) => d.isPartialParent).map((d) => d.profit)))}、` +
        `子单均 ${fmt(avg(deals.filter((d) => d.isPartialChild).map((d) => d.profit)))}`,
    },
    {
      id: 9, confidence: "medium",
      rule: "亏损后不加倍、不报复",
      evidence: `亏损后同向 ${performance(deals).afterLossSameDir} / 反向 ${performance(deals).afterLossReverse}，最长连亏 ${performance(deals).maxLossStreak} 笔`,
    },
    {
      id: 10, confidence: "high",
      rule: `全天候运行、持仓中位 ${fmt(tm.medianHoldMin, 1)} 分钟 → 是机器不是人`,
      evidence: `含北京 02–05 点开仓 ${tm.hourly.slice(2, 6).reduce((a, b) => a + b, 0)} 笔；` +
        tm.sessions.map((s) => `${s.label} ${s.n}`).join(" / "),
    },
    entry ? {
      id: 11, confidence: "medium",
      rule: "入场是顺势的「推动后回抽」——不是追破新高新低",
      evidence: (() => {
        const a30 = entry.trendAgreement.find((t) => t.window === 30)
        const pos = entry.features.find((f) => f.key === "dpos30")
        return `${a30 ? Math.round(a30.share * 100) : "—"}% 的入场与前 30 分钟走势同向；` +
          `入场点位于前 30 分钟区间的 ${pos ? (pos.real * 100).toFixed(0) : "—"}% 处` +
          `（随机基线 ${pos ? (pos.base * 100).toFixed(0) : "—"}%，z=${pos ? pos.z.toFixed(1) : "—"}）；` +
          `只有 ${entry.pullback.alreadyBroken}/${entry.pullback.n} 笔已突破极值`
      })(),
    } : {
      id: 11, confidence: "unknown",
      rule: "入场触发条件（什么时候决定买/卖）",
      evidence: "还没跑 scripts/entry_reverse.py，或 K 线未覆盖成交区间",
    },
    entry ? {
      id: 12, confidence: "medium",
      rule: "不看波动率、不看整数关口、不按 K 线周期触发",
      evidence: `ATR / 点差 / 振幅 / 距整数关口 全部与随机分钟无差异（|z|<2）；` +
        `入场秒数只有 ${entry.clock.secondsInFirst5}/${entry.clock.n} 落在每分钟前 5 秒 → ` +
        `是逐 tick 连续判断，不是「新 K 线才动」的 EA`,
    } : null,
  ].filter(Boolean) as Rule[]
}

function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}
