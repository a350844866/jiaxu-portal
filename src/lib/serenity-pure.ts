// Pure (browser-safe) helpers + types for the Serenity dashboard.
// NO node:fs / node:path imports here, so client components can import freely.
// Server-only IO (readLedger/readTweets) lives in serenity-reader.ts.

export type Stance = "新开" | "加码" | "持有" | "减仓" | "反手做空" | "转静默" | "观察"
export type Verdict = "兑现" | "落空" | "待核" | "不可证伪" | "归因不稳"

export interface Position {
  ticker: string
  name: string
  chain: string
  stance: Stance
  thesis: string
  instrument: string
  last_mention: string
  status: string
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

export function parseLedger(raw: string): Ledger {
  const o = JSON.parse(raw)
  return {
    updated: o.updated ?? "",
    last_distilled_ts: o.last_distilled_ts ?? "",
    self_reported: o.self_reported ?? { ytd_pct: 0, two_year_pct: 0, as_of: "" },
    positions: Array.isArray(o.positions) ? o.positions : [],
    predictions: Array.isArray(o.predictions) ? o.predictions : [],
    catalysts: Array.isArray(o.catalysts) ? o.catalysts : [],
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
