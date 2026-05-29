// Pure (browser-safe) helpers + types for the Serenity dashboard.
// NO node:fs / node:path imports here, so client components can import freely.
// Server-only IO (readLedger/readTweets) lives in serenity-reader.ts.

// Closed enums as const arrays so they double as runtime allow-lists (parseLedger
// clamps to these) AND as the source of the literal-union types below.
export const STANCES = ["新开", "加码", "持有", "减仓", "反手做空", "转静默", "观察"] as const
export const VERDICTS = ["兑现", "落空", "待核", "不可证伪", "归因不稳"] as const
export const STATUSES = ["active", "watch", "trimmed", "thesis-played-out"] as const

export type Stance = (typeof STANCES)[number]
export type Verdict = (typeof VERDICTS)[number]
export type Status = (typeof STATUSES)[number]

export interface Position {
  ticker: string
  name: string
  chain: string
  stance: Stance
  thesis: string
  instrument: string
  last_mention: string
  status: Status
}

export interface Prediction {
  date: string
  claim: string
  falsifiable: string
  verdict: Verdict
  due: string | null
  note: string
}

export interface Catalyst {
  date: string
  event: string
  chain: string
}

export interface Ledger {
  updated: string
  last_distilled_ts: string
  self_reported: { ytd_pct: number; two_year_pct: number; as_of: string }
  positions: Position[]
  predictions: Prediction[]
  catalysts: Catalyst[]
}

const TICKER_RE = /\$([A-Z]{1,6}(?:\.[A-Z])?)\b/g

export interface Tweet {
  id: string
  text: string
  timestamp: string
  likes: number
  likesRaw: string
  url: string
}

export interface TweetFilter {
  ticker?: string
  date?: string      // YYYY-MM-DD prefix match on timestamp
  minLikes?: number
  q?: string         // free-text body search
}

export function parseLikes(s: string): number {
  if (!s) return 0
  const m = /^(\d+(?:\.\d+)?)\s*([KM]?)$/i.exec(s.trim())
  if (!m) return 0
  const n = parseFloat(m[1])
  if (isNaN(n)) return 0
  const mult = m[2].toUpperCase() === "K" ? 1000 : m[2].toUpperCase() === "M" ? 1_000_000 : 1
  return Math.round(n * mult)
}

function asStr(v: unknown): string {
  return v == null ? "" : String(v)
}

// Clamp an untrusted value to a known enum; warn (server log) on drift so a
// renamed ledger value surfaces instead of silently rendering with a fallback.
function clampEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T, label: string): T {
  if (typeof v === "string" && (allowed as readonly string[]).includes(v)) return v as T
  if (v !== undefined && v !== null) {
    console.warn(`[serenity] unknown ${label} in ledger: ${String(v)} -> ${fallback}`)
  }
  return fallback
}

function coercePosition(x: unknown): Position {
  const o = (x ?? {}) as Record<string, unknown>
  return {
    ticker: asStr(o.ticker),
    name: asStr(o.name),
    chain: asStr(o.chain),
    stance: clampEnum(o.stance, STANCES, "观察", "stance"),
    thesis: asStr(o.thesis),
    instrument: asStr(o.instrument),
    last_mention: asStr(o.last_mention),
    status: clampEnum(o.status, STATUSES, "watch", "status"),
  }
}

function coercePrediction(x: unknown): Prediction {
  const o = (x ?? {}) as Record<string, unknown>
  return {
    date: asStr(o.date),
    claim: asStr(o.claim),
    falsifiable: asStr(o.falsifiable),
    verdict: clampEnum(o.verdict, VERDICTS, "待核", "verdict"),
    due: o.due == null ? null : String(o.due),
    note: asStr(o.note),
  }
}

function coerceCatalyst(x: unknown): Catalyst {
  const o = (x ?? {}) as Record<string, unknown>
  return { date: asStr(o.date), event: asStr(o.event), chain: asStr(o.chain) }
}

export function parseLedger(raw: string): Ledger {
  const o = JSON.parse(raw) as Record<string, unknown>
  const sr = (o.self_reported ?? {}) as Record<string, unknown>
  return {
    updated: asStr(o.updated),
    last_distilled_ts: asStr(o.last_distilled_ts),
    self_reported: {
      ytd_pct: Number(sr.ytd_pct) || 0,
      two_year_pct: Number(sr.two_year_pct) || 0,
      as_of: asStr(sr.as_of),
    },
    positions: Array.isArray(o.positions) ? o.positions.map(coercePosition) : [],
    predictions: Array.isArray(o.predictions) ? o.predictions.map(coercePrediction) : [],
    catalysts: Array.isArray(o.catalysts) ? o.catalysts.map(coerceCatalyst) : [],
  }
}

export function filterTweets(tweets: Tweet[], f: TweetFilter): Tweet[] {
  return tweets.filter((t) => {
    if (f.ticker) {
      const want = f.ticker.replace(/^\$/, "").toUpperCase()
      const has = (t.text.match(TICKER_RE) || []).some(
        (m) => m.slice(1).toUpperCase() === want,
      )
      if (!has) return false
    }
    if (f.date && !t.timestamp.startsWith(f.date)) return false
    if (typeof f.minLikes === "number" && t.likes < f.minLikes) return false
    if (f.q && !t.text.toLowerCase().includes(f.q.toLowerCase())) return false
    return true
  })
}

export function tweetCountByDay(tweets: Tweet[]): { day: string; count: number }[] {
  const m = new Map<string, number>()
  for (const t of tweets) {
    const day = t.timestamp.slice(0, 10)
    m.set(day, (m.get(day) ?? 0) + 1)
  }
  return Array.from(m.entries())
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day.localeCompare(b.day))
}

export function tickerMentionCounts(tweets: Tweet[]): { ticker: string; count: number }[] {
  const m = new Map<string, number>()
  for (const t of tweets) {
    const seen = new Set<string>()
    for (const match of t.text.match(TICKER_RE) || []) {
      const tk = match.slice(1).toUpperCase()
      if (seen.has(tk)) continue   // count once per tweet
      seen.add(tk)
      m.set(tk, (m.get(tk) ?? 0) + 1)
    }
  }
  return Array.from(m.entries())
    .map(([ticker, count]) => ({ ticker, count }))
    .sort((a, b) => b.count - a.count || a.ticker.localeCompare(b.ticker))
}

export function verdictBreakdown(preds: Prediction[]): { verdict: Verdict; count: number }[] {
  const m = new Map<Verdict, number>()
  for (const p of preds) m.set(p.verdict, (m.get(p.verdict) ?? 0) + 1)
  return Array.from(m.entries()).map(([verdict, count]) => ({ verdict, count }))
}
