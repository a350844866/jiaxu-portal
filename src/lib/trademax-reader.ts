/**
 * trademax-observer state reader.
 *
 * Reads the artifacts written by /data/trademax-observer's watcher
 * (`watch.py`, systemd `trademax-observer.service`), mounted read-only at
 * TRADEMAX_DATA_DIR. Every read is best-effort — a missing file degrades to
 * a null field rather than throwing, same contract as pm-scalp-reader.
 *
 * File contracts:
 *   trades.csv    closed deals, deduped by ticket, append-only
 *   live.jsonl    one record per change in the open-position table
 *   watch.status  {heartbeat, polls, account, open_rows} rewritten each poll
 *   account.json  {balance_ops, summary:{deposit,…}} rewritten on history merge
 */
import { promises as fs } from "node:fs"
import path from "node:path"

import {
  type Deal, type PendingOrder, type Performance, type EquityCurve,
  type DayStat, type Bucket, type StopStructure, type TimingStats,
  type ConcurrencyCheck, type RiskProfile, type LiveEvent, type Rule,
  type AccountBar, type OpenPosition,
  parseTradesCsv, performance, equityCurve, byDay, exitBuckets, stopStructure,
  timing, concurrency, riskProfile, parseLiveFeed, ruleSet, parseAccountBar,
} from "./trademax-pure"

const DATA_DIR = process.env.TRADEMAX_DATA_DIR || "/data/trademax-observer"
/** watcher polls every 10s; 5 min of silence means the session is gone */
const STALE_AFTER_SEC = 300

export interface BalanceOp {
  ticket: string
  time: string
  type: string
  comment: string
  amount: string
}

export interface WatchStatus {
  heartbeat: string | null
  ageSeconds: number | null
  stale: boolean
  polls: number | null
  openRows: number | null
  bar: AccountBar
}

export interface TradeMaxSnapshot {
  ok: boolean
  error: string | null
  account: {
    login: string
    server: string
    broker: string
    deposit: number
    balance: number | null
    equity: number | null
    netPnl: number
    returnPct: number | null
    fundedBy: string | null
    firstDeal: string | null
    lastDeal: string | null
  }
  watch: WatchStatus
  openPositions: OpenPosition[]
  deals: Deal[]
  pending: PendingOrder[]
  perf: Performance
  equity: EquityCurve
  days: DayStat[]
  exits: Bucket[]
  stops: StopStructure
  timing: TimingStats
  concurrency: ConcurrencyCheck
  risk: RiskProfile
  rules: Rule[]
  live: LiveEvent[]
}

async function readText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(DATA_DIR, file), "utf8")
  } catch {
    return null
  }
}

async function readJson<T>(file: string): Promise<T | null> {
  const t = await readText(file)
  if (!t) return null
  try {
    return JSON.parse(t) as T
  } catch {
    return null
  }
}

function emptySnapshot(error: string): TradeMaxSnapshot {
  const empty = parseTradesCsv("")
  const stops = stopStructure([])
  return {
    ok: false,
    error,
    account: {
      login: process.env.TRADEMAX_LOGIN || "6176972",
      server: process.env.TRADEMAX_SERVER || "TradeMaxGlobal-Live6",
      broker: "TradeMax Global Limited (TMGM)",
      deposit: 0, balance: null, equity: null, netPnl: 0, returnPct: null,
      fundedBy: null, firstDeal: null, lastDeal: null,
    },
    watch: { heartbeat: null, ageSeconds: null, stale: true, polls: null, openRows: null,
             bar: { balance: null, equity: null, freeMargin: null } },
    openPositions: [],
    deals: empty.deals,
    pending: empty.pending,
    perf: performance([]),
    equity: equityCurve([], 0),
    days: [],
    exits: [],
    stops,
    timing: timing([]),
    concurrency: concurrency([]),
    risk: riskProfile([], 0, null),
    rules: [],
    live: [],
  }
}

export async function readTradeMaxSnapshot(): Promise<TradeMaxSnapshot> {
  const csv = await readText("data/trades.csv")
  if (!csv) return emptySnapshot("trades.csv 不可读——观察栈可能没在跑或挂载缺失")

  const { deals, pending } = parseTradesCsv(csv)
  const accountMeta = await readJson<{
    balance_ops?: BalanceOp[]
    summary?: { deposit?: number; profit_loss?: number; withdrawal?: number }
  }>("data/account.json")
  const status = await readJson<{
    heartbeat?: string; polls?: number; account?: string | null; open_rows?: number
  }>("data/watch.status")
  const liveText = await readText("data/live.jsonl")

  const depositOp = accountMeta?.balance_ops?.[0] ?? null
  const deposit = accountMeta?.summary?.deposit
    ?? (depositOp ? Number(depositOp.amount) : 0)
    ?? 0

  const bar = status?.account ? parseAccountBar(status.account) : { balance: null, equity: null, freeMargin: null }
  const heartbeat = status?.heartbeat ?? null
  const ageSeconds = heartbeat ? Math.max(0, Math.round((Date.now() - Date.parse(heartbeat)) / 1000)) : null

  const live = liveText ? parseLiveFeed(liveText) : []
  const openPositions = live.length ? live[0].positions : []

  const eq = equityCurve(deals, deposit)
  const stops = stopStructure(deals)
  const balance = bar.balance ?? eq.end
  const risk = riskProfile(deals, balance, stops.medianRiskUsd, deposit)
  const conc = concurrency(deals)
  const tm = timing(deals)

  return {
    ok: true,
    error: null,
    account: {
      login: process.env.TRADEMAX_LOGIN || "6176972",
      server: process.env.TRADEMAX_SERVER || "TradeMaxGlobal-Live6",
      broker: "TradeMax Global Limited (TMGM)",
      deposit,
      balance,
      equity: bar.equity,
      netPnl: eq.end - deposit,
      returnPct: eq.returnPct,
      fundedBy: depositOp?.comment ?? null,
      firstDeal: deals.length ? deals[0].openTime : null,
      lastDeal: deals.length ? (deals[deals.length - 1].closeTime ?? deals[deals.length - 1].openTime) : null,
    },
    watch: {
      heartbeat,
      ageSeconds,
      stale: ageSeconds == null || ageSeconds > STALE_AFTER_SEC,
      polls: status?.polls ?? null,
      openRows: status?.open_rows ?? null,
      bar,
    },
    openPositions,
    deals,
    pending,
    perf: performance(deals),
    equity: eq,
    days: byDay(deals, deposit),
    exits: exitBuckets(deals),
    stops,
    timing: tm,
    concurrency: conc,
    risk,
    rules: ruleSet(deals, stops, conc, risk, tm),
    live,
  }
}

/** Compact payload for the home-page card — no per-deal rows. */
export interface TradeMaxCardData {
  ok: boolean
  error: string | null
  balance: number | null
  netPnl: number
  returnPct: number | null
  nDeals: number
  winRate: number | null
  payoff: number | null
  profitFactor: number | null
  maxDrawdownPct: number | null
  openPositions: number
  stale: boolean
  ageSeconds: number | null
  sampleProgress: { have: number; need: number; pct: number }
  lastNote: string | null
}

export async function readTradeMaxCard(): Promise<TradeMaxCardData> {
  const s = await readTradeMaxSnapshot()
  return {
    ok: s.ok,
    error: s.error,
    balance: s.account.balance,
    netPnl: s.account.netPnl,
    returnPct: s.account.returnPct,
    nDeals: s.perf.n,
    winRate: s.perf.winRate,
    payoff: s.perf.payoff,
    profitFactor: s.perf.profitFactor,
    maxDrawdownPct: s.equity.maxDrawdownPct,
    openPositions: s.openPositions.length,
    stale: s.watch.stale,
    ageSeconds: s.watch.ageSeconds,
    sampleProgress: s.risk.sampleProgress,
    lastNote: s.live.length ? `${s.live[0].note}` : null,
  }
}
