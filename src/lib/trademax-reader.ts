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
  type AccountBar, type OpenPosition, type EntryAnalysis,
  parseTradesCsv, performance, equityCurve, byDay, exitBuckets, stopStructure,
  timing, concurrency, riskProfile, parseLiveFeed, ruleSet, parseAccountBar,
  parseEntryAnalysis,
} from "./trademax-pure"

const BASE_DIR = process.env.TRADEMAX_DATA_DIR || "/data/trademax-observer"
/** watcher polls every 10s; 5 min of silence means the session is gone */
const STALE_AFTER_SEC = 300

/** Observed accounts. Each watcher writes into its own subdirectory. */
export interface AccountDef {
  slug: string
  label: string
  login: string
  server: string
  broker: string
  /** path under BASE_DIR holding trades.csv / live.jsonl / watch.status */
  dir: string
  note: string
}

export const ACCOUNTS: AccountDef[] = [
  {
    slug: "trademax", label: "黄金一次一单", login: "6176972",
    server: "TradeMaxGlobal-Live6", broker: "TradeMax Global Limited (TMGM)",
    dir: "data", note: "观摩(只读)密码",
  },
  {
    slug: "dls", label: "MT4趋势一次一单", login: "260276",
    server: "DLSMarkets-Live", broker: "DLS Markets Limited",
    dir: "data/dls", note: "⚠ 疑似主密码(可下单)，观察栈只读",
  },
  {
    slug: "grand", label: "多指标共振网格", login: "10633750",
    server: "GrandMarkets-Live1", broker: "Grand Markets Limited",
    dir: "data/grand",
    note: "⚠ 疑似主密码；5478 笔全量由券商客户端导出（网页版封顶 1000）",
  },
]

export function accountBySlug(slug: string | undefined): AccountDef {
  return ACCOUNTS.find((a) => a.slug === slug) ?? ACCOUNTS[0]
}

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
  slug: string
  label: string
  accounts: { slug: string; label: string }[]
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
  entry: EntryAnalysis | null
}

async function readText(acct: AccountDef, file: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(BASE_DIR, acct.dir, file), "utf8")
  } catch {
    return null
  }
}

async function readJson<T>(acct: AccountDef, file: string): Promise<T | null> {
  const t = await readText(acct, file)
  if (!t) return null
  try {
    return JSON.parse(t) as T
  } catch {
    return null
  }
}

function emptySnapshot(error: string, acct: AccountDef): TradeMaxSnapshot {
  const empty = parseTradesCsv("")
  const stops = stopStructure([])
  return {
    ok: false,
    error,
    slug: acct.slug,
    label: acct.label,
    accounts: ACCOUNTS.map((a) => ({ slug: a.slug, label: a.label })),
    account: {
      login: acct.login,
      server: acct.server,
      broker: acct.broker,
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
    risk: riskProfile([], 0, null, 0),
    rules: [],
    live: [],
    entry: null,
  }
}

export async function readTradeMaxSnapshot(slug?: string): Promise<TradeMaxSnapshot> {
  const acct = accountBySlug(slug)
  const csv = await readText(acct, "trades.csv")
  if (!csv) return emptySnapshot("trades.csv 不可读——观察栈可能没在跑或挂载缺失", acct)

  const { deals, pending } = parseTradesCsv(csv)
  const accountMeta = await readJson<{
    balance_ops?: BalanceOp[]
    summary?: { deposit?: number; profit_loss?: number; withdrawal?: number }
  }>(acct, "account.json")
  const status = await readJson<{
    heartbeat?: string; polls?: number; account?: string | null; open_rows?: number
  }>(acct, "watch.status")
  const liveText = await readText(acct, "live.jsonl")
  const entry = parseEntryAnalysis(await readJson(acct, "entry-analysis.json"))

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
    slug: acct.slug,
    label: acct.label,
    accounts: ACCOUNTS.map((a) => ({ slug: a.slug, label: a.label })),
    account: {
      login: acct.login,
      server: acct.server,
      broker: acct.broker,
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
    rules: ruleSet(deals, stops, conc, risk, tm, entry),
    live,
    entry,
  }
}

/** Compact payload for the home-page card — no per-deal rows. */
export interface TradeMaxCardData {
  slug: string
  label: string
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

export async function readTradeMaxCard(slug?: string): Promise<TradeMaxCardData> {
  const s = await readTradeMaxSnapshot(slug)
  return {
    slug: s.slug,
    label: s.label,
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
