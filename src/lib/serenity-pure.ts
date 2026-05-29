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

// 单一来源:筛选/计数(.match→slice(1))与正文高亮(.split,捕获组含 $)共用。
// 捕获组把 $ 含在内,使 split 保留的片段带 $,便于高亮判定。
export const TICKER_RE = /(\$[A-Z]{1,6}(?:\.[A-Z])?)\b/g

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
  // 剥千分位逗号("1,234"→1234),否则正则失配静默归零、minLikes 筛选会漏掉高赞推
  const m = /^(\d+(?:\.\d+)?)\s*([KM]?)$/i.exec(s.trim().replace(/,/g, ""))
  if (!m) return 0
  const n = parseFloat(m[1])
  if (isNaN(n)) return 0
  const mult = m[2].toUpperCase() === "K" ? 1000 : m[2].toUpperCase() === "M" ? 1_000_000 : 1
  return Math.round(n * mult)
}

// 抓取来的 url 不可信:只放行 http/https,挡掉 javascript:/data: 等注入。非法返回 ""。
export function safeHttpUrl(s: string): string {
  const t = s.trim()
  return /^https?:\/\//i.test(t) ? t : ""
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

// catalyst date 是混合格式(YYYY-MM-DD / ~YYYY-MM-DD / "YYYY Qn" / "Hn YYYY" / "3-10 月内"),
// 提取可排序数字键(升序=时间最近在前)。无法定位年份的(纯相对时段)排末尾,不随机插入。
export function catalystSortKey(date: string): number {
  const ymd = /(\d{4})-(\d{2})-(\d{2})/.exec(date)
  if (ymd) return Number(ymd[1] + ymd[2] + ymd[3])
  const year = /(\d{4})/.exec(date)
  if (!year) return Number.MAX_SAFE_INTEGER
  const q = /Q([1-4])/i.exec(date)
  const h = /H([12])/i.exec(date)
  // Q1→3 Q2→6 Q3→9 Q4→12;H1→6 H2→12;只有年→年中
  const mm = q ? Number(q[1]) * 3 : h ? Number(h[1]) * 6 : 0
  return Number(year[1]) * 10000 + mm * 100
}

// 不信任 ledger 书写顺序,渲染前确定性排序;同键保持原序(稳定)。
export function sortCatalysts(catalysts: Catalyst[]): Catalyst[] {
  return catalysts
    .map((c, i) => ({ c, i, k: catalystSortKey(c.date) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((x) => x.c)
}
