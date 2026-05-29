# Serenity Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only `/serenity` subpage in jiaxu-portal that visualizes Serenity (@aleabitoreddit) holdings, prediction track-record, and the raw tweet stream — fed by a JSON sidecar (`ledger.json`) plus the existing tweet corpus.

**Architecture:** Server components read two JSON files at request time (mirroring the existing `todo-reader.ts` → `TodoCard` pattern). A `serenity-reader.ts` lib parses `ledger.json` (curated holdings/predictions/catalysts) and `tweets-full.json` (2728 tweets) into structured snapshots with derived aggregates. The page renders 4 zones (KPI bar, holdings grid, hand-rolled SVG charts, tweet browser). Only search/filter/drawer interactivity is client-side; all data fetching and derivation stays server-side to avoid SSR hydration races.

**Tech Stack:** Next.js 16 (App Router, server components), React 19, Tailwind 4, lucide-react icons, vitest. No new dependencies — charts are hand-rolled SVG/CSS.

---

## File Structure

- `data/serenity/ledger.json` — **source-controlled fixture seed** committed in portal repo so the dashboard renders before first distillation writes the live one. At runtime the live ledger comes from the mounted corpus dir.
- `src/lib/serenity-reader.ts` — reads `ledger.json` + `tweets-full.json` from `SERENITY_CORPUS_DIR`; parses likes strings → numbers; exposes filters + derived aggregates; fault-tolerant `{ok:false}` on read failure.
- `src/lib/__tests__/serenity-reader.test.ts` — unit tests with inline fixtures.
- `src/components/dashboard/serenity/kpi-bar.tsx` — server component, top KPI strip.
- `src/components/dashboard/serenity/holdings-grid.tsx` — server component, holdings cards grouped by chain + stance color.
- `src/components/dashboard/serenity/charts.tsx` — server component, 3 hand-rolled SVG charts.
- `src/components/dashboard/serenity/tweet-browser.tsx` — `"use client"`, searchable/filterable paginated tweet list.
- `src/components/dashboard/serenity/ticker-drawer.tsx` — `"use client"`, drawer showing one ticker's tweets (props from server).
- `src/app/serenity/page.tsx` — route, auth gate + assembles the 4 zones.

---

## Task 1: serenity-reader lib — types + ledger reader (TDD)

**Files:**
- Create: `src/lib/serenity-reader.ts`
- Test: `src/lib/__tests__/serenity-reader.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/__tests__/serenity-reader.test.ts
import { describe, it, expect } from "vitest"
import { parseLikes, parseLedger, type Ledger } from "../serenity-reader"

describe("parseLikes", () => {
  it("parses plain numbers", () => {
    expect(parseLikes("72")).toBe(72)
  })
  it("parses K-suffixed", () => {
    expect(parseLikes("1.2K")).toBe(1200)
    expect(parseLikes("2K")).toBe(2000)
  })
  it("parses M-suffixed", () => {
    expect(parseLikes("1.5M")).toBe(1500000)
  })
  it("returns 0 for junk", () => {
    expect(parseLikes("")).toBe(0)
    expect(parseLikes("abc")).toBe(0)
  })
})

describe("parseLedger", () => {
  const raw = JSON.stringify({
    updated: "2026-05-29",
    last_distilled_ts: "2026-05-28T19:09:33.000Z",
    self_reported: { ytd_pct: 4502.45, two_year_pct: 22561.99, as_of: "2026-05-26" },
    positions: [
      { ticker: "SIVE", name: "Sivers", chain: "CPO", stance: "加码", thesis: "x", instrument: "现货", last_mention: "2026-05-28", status: "active" },
    ],
    predictions: [
      { date: "2026-05-28", claim: "EWY +428%", falsifiable: "hard", verdict: "待核", due: null, note: "" },
    ],
    catalysts: [{ date: "~2026-06-01", event: "SIVE inflow", chain: "SIVE" }],
  })

  it("parses a well-formed ledger", () => {
    const l = parseLedger(raw) as Ledger
    expect(l.positions).toHaveLength(1)
    expect(l.positions[0].ticker).toBe("SIVE")
    expect(l.predictions[0].verdict).toBe("待核")
    expect(l.self_reported.ytd_pct).toBe(4502.45)
  })

  it("throws on malformed JSON", () => {
    expect(() => parseLedger("{not json")).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /programHost/vibe-coding/jiaxu-portal && npx vitest run src/lib/__tests__/serenity-reader.test.ts`
Expected: FAIL — "Cannot find module '../serenity-reader'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/serenity-reader.ts
import { promises as fs } from "node:fs"
import path from "node:path"

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

const CORPUS_DIR = process.env.SERENITY_CORPUS_DIR || "/data/x-corpus"
const LEDGER_PATH = path.join(CORPUS_DIR, "ledger.json")

export function parseLikes(s: string): number {
  if (!s) return 0
  const m = /^([\d.]+)\s*([KM]?)$/i.exec(s.trim())
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

export async function readLedger(): Promise<
  { ok: true; ledger: Ledger; ageSeconds: number } | { ok: false; error: string }
> {
  try {
    const stat = await fs.stat(LEDGER_PATH)
    const raw = await fs.readFile(LEDGER_PATH, "utf-8")
    return { ok: true, ledger: parseLedger(raw), ageSeconds: Math.round((Date.now() - stat.mtimeMs) / 1000) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/serenity-reader.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/serenity-reader.ts src/lib/__tests__/serenity-reader.test.ts
git -c user.email=jiaxu@local commit -m "feat(serenity): ledger reader + likes parser with tests"
```

---

## Task 2: serenity-reader — tweet reader + filters + aggregates (TDD)

**Files:**
- Modify: `src/lib/serenity-reader.ts` (append)
- Modify: `src/lib/__tests__/serenity-reader.test.ts` (append)

- [ ] **Step 1: Write the failing test (append to test file)**

```typescript
import { filterTweets, tweetCountByDay, tickerMentionCounts, verdictBreakdown, type Tweet } from "../serenity-reader"

const tweets: Tweet[] = [
  { id: "1", text: "$SIVE is the best $AAOI too", timestamp: "2026-05-28T10:00:00.000Z", likes: 2100, likesRaw: "2.1K", url: "u1" },
  { id: "2", text: "$SIVE again", timestamp: "2026-05-28T12:00:00.000Z", likes: 80, likesRaw: "80", url: "u2" },
  { id: "3", text: "dog charity unrelated", timestamp: "2026-05-27T09:00:00.000Z", likes: 30, likesRaw: "30", url: "u3" },
]

describe("filterTweets", () => {
  it("filters by ticker (case-insensitive, $-prefixed)", () => {
    expect(filterTweets(tweets, { ticker: "SIVE" }).map(t => t.id)).toEqual(["1", "2"])
  })
  it("filters by date prefix", () => {
    expect(filterTweets(tweets, { date: "2026-05-27" }).map(t => t.id)).toEqual(["3"])
  })
  it("filters by minLikes", () => {
    expect(filterTweets(tweets, { minLikes: 100 }).map(t => t.id)).toEqual(["1"])
  })
  it("free-text search matches body", () => {
    expect(filterTweets(tweets, { q: "charity" }).map(t => t.id)).toEqual(["3"])
  })
})

describe("aggregates", () => {
  it("tweetCountByDay buckets by date", () => {
    expect(tweetCountByDay(tweets)).toEqual([
      { day: "2026-05-27", count: 1 },
      { day: "2026-05-28", count: 2 },
    ])
  })
  it("tickerMentionCounts counts $TICKERs, sorted desc", () => {
    const c = tickerMentionCounts(tweets)
    expect(c[0]).toEqual({ ticker: "SIVE", count: 2 })
    expect(c).toContainEqual({ ticker: "AAOI", count: 1 })
  })
  it("verdictBreakdown tallies prediction verdicts", () => {
    const preds = [
      { date: "", claim: "", falsifiable: "", verdict: "待核" as const, due: null, note: "" },
      { date: "", claim: "", falsifiable: "", verdict: "待核" as const, due: null, note: "" },
      { date: "", claim: "", falsifiable: "", verdict: "不可证伪" as const, due: null, note: "" },
    ]
    expect(verdictBreakdown(preds)).toEqual([
      { verdict: "待核", count: 2 },
      { verdict: "不可证伪", count: 1 },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/serenity-reader.test.ts`
Expected: FAIL — "filterTweets is not exported" / type errors

- [ ] **Step 3: Write minimal implementation (append to serenity-reader.ts)**

```typescript
const TWEETS_PATH = path.join(CORPUS_DIR, "tweets-full.json")
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

export async function readTweets(): Promise<
  { ok: true; tweets: Tweet[]; ageSeconds: number } | { ok: false; error: string }
> {
  try {
    const stat = await fs.stat(TWEETS_PATH)
    const raw = await fs.readFile(TWEETS_PATH, "utf-8")
    const arr = JSON.parse(raw)
    const list: unknown[] = Array.isArray(arr) ? arr : arr.tweets ?? []
    const tweets: Tweet[] = list.map((x) => {
      const o = x as Record<string, unknown>
      const likesRaw = String(o.likes ?? "0")
      return {
        id: String(o.id ?? ""),
        text: String(o.text ?? ""),
        timestamp: String(o.timestamp ?? ""),
        likes: parseLikes(likesRaw),
        likesRaw,
        url: String(o.url ?? ""),
      }
    })
    return { ok: true, tweets, ageSeconds: Math.round((Date.now() - stat.mtimeMs) / 1000) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/serenity-reader.test.ts`
Expected: PASS (all tests, ~13 total)

- [ ] **Step 5: Commit**

```bash
git add src/lib/serenity-reader.ts src/lib/__tests__/serenity-reader.test.ts
git -c user.email=jiaxu@local commit -m "feat(serenity): tweet reader, filters, derived aggregates with tests"
```

---

## Task 3: Seed ledger.json fixture from the live activity-ledger markdown

**Files:**
- Create: `data/serenity/ledger.json`

This is the structured transcription of `wiki/notes/serenity-活账本.md` (already written). Source-controlled so dashboard renders before the first distillation writes the live copy into the mounted corpus dir.

- [ ] **Step 1: Write the seed file**

```json
{
  "updated": "2026-05-29",
  "last_distilled_ts": "2026-05-28T19:09:33.000Z",
  "self_reported": { "ytd_pct": 4502.45, "two_year_pct": 22561.99, "as_of": "2026-05-26" },
  "positions": [
    { "ticker": "SIVE", "name": "Sivers", "chain": "CPO/光子激光上游", "stance": "加码", "thesis": "Ayar/Lightmatter/Celestial 的 sole-source 激光;$2.6B MC 拿同行 $5-15B 反推 → next $80B $LITE;一股没卖+计划增持", "instrument": "现货", "last_mention": "2026-05-28", "status": "active" },
    { "ticker": "XFAB", "name": "X-Fab", "chain": "SiC foundry + 光子", "stance": "新开", "thesis": "NIST 称美国唯一高产能 SiC = critical infra;power semi 主线 + silicon photonics 期权;EU Chips Act 2 catalyst", "instrument": "现货", "last_mention": "2026-05-28", "status": "active" },
    { "ticker": "EWY", "name": "iShares Korea", "chain": "韩国 memory 代理", "stance": "加码", "thesis": "IV 套利 + SK Hynix/Samsung memory 升值;自报 +428%/5.2x in 3mo", "instrument": "OTM LEAPs", "last_mention": "2026-05-28", "status": "active" },
    { "ticker": "AAOI", "name": "Applied Optoelectronics", "chain": "光子/激光 fab", "stance": "持有", "thesis": "$13B MC 比 $2B/$6B 时更看多;潜在 $NVDA/$AMD 长约;自报 7x", "instrument": "现货+LEAPs", "last_mention": "2026-05-28", "status": "active" },
    { "ticker": "SOI", "name": "Soitec", "chain": "SOI substrate/硅光", "stance": "持有", "thesis": "substrate 准垄断;$44→$170-181 自报 4x;机构吃 float 后涨", "instrument": "现货", "last_mention": "2026-05-28", "status": "active" },
    { "ticker": "AXTI", "name": "AXT Inc", "chain": "InP 衬底上游", "stance": "持有", "thesis": "光通信激光器必需,自称占上游 ~40%;自报 thousands%", "instrument": "现货+LEAPs", "last_mention": "2026-05-27", "status": "active" },
    { "ticker": "RPI", "name": "RPI", "chain": "agentic AI hardware", "stance": "持有", "thesis": "$280→$800 自报;meme stock 框架反指标兑现", "instrument": "现货", "last_mention": "2026-05-25", "status": "active" },
    { "ticker": "IQE", "name": "IQE plc", "chain": "化合物半导体 epitaxy", "stance": "持有", "thesis": "欧洲 long;自评只 3x+ 期望更高", "instrument": "现货", "last_mention": "2026-05-28", "status": "active" },
    { "ticker": "NBIS", "name": "Nebius", "chain": "NeoCloud 算力", "stance": "持有", "thesis": "2025 起 long 自报 ~3x;对比 $IREN 强(dilution 结构)", "instrument": "现货", "last_mention": "2026-05-28", "status": "active" },
    { "ticker": "NVTS", "name": "Navitas", "chain": "800VDC power semi", "stance": "持有", "thesis": "$NVDA 800VDC push 受益;自报已翻倍", "instrument": "现货", "last_mention": "2026-05-26", "status": "active" },
    { "ticker": "LPK", "name": "Lumibird/LPKF", "chain": "玻璃 core substrate", "stance": "持有", "thesis": "准垄断;$6 thesis@$13→$24.2 自报", "instrument": "现货", "last_mention": "2026-05-25", "status": "active" },
    { "ticker": "HPS.A", "name": "Hammond Power", "chain": "电网变压器", "stance": "观察", "thesis": "backlog 强份额高 compelling compounder;未确认建仓", "instrument": "—", "last_mention": "2026-05-28", "status": "watch" },
    { "ticker": "VPG", "name": "Vishay Precision", "chain": "传感", "stance": "减仓", "thesis": "3x 但自承 ASP 模型错($150 vs ~$750);$TSLA design-out 砍集中度", "instrument": "现货", "last_mention": "2026-05-26", "status": "trimmed" },
    { "ticker": "MU", "name": "Micron", "chain": "DRAM/HBM memory", "stance": "持有", "thesis": "thesis 已兑现:next $NVDA;$80→$887 破 $1T mcap 自报", "instrument": "—", "last_mention": "2026-05-26", "status": "thesis-played-out" }
  ],
  "predictions": [
    { "date": "2026-05-26", "claim": "YTD 4502.45%", "falsifiable": "不可独立审计", "verdict": "不可证伪", "due": null, "note": "IBKR 子账户平台口径,非审计净值" },
    { "date": "2026-05-26", "claim": "2 Year Return 22,561.99%", "falsifiable": "数学反推与披露仓位量级不匹配", "verdict": "不可证伪", "due": null, "note": "226x,与 2025-09 单票仓位量级不符" },
    { "date": "2026-05-28", "claim": "$EWY 2028 LEAPs +428% / 5.2x in 3mo", "falsifiable": "options 难独立核", "verdict": "待核", "due": null, "note": "" },
    { "date": "2026-05-28", "claim": "$SOI $44→$170-181 (4x)", "falsifiable": "价格可查", "verdict": "待核", "due": null, "note": "IBKR 恢复后补" },
    { "date": "2026-05-26", "claim": "$MU $80→$887 破 $1T mcap", "falsifiable": "价格可查(流动票)", "verdict": "待核", "due": null, "note": "" },
    { "date": "2026-05-28", "claim": "$RPI $280→$800", "falsifiable": "价格可查", "verdict": "待核", "due": null, "note": "" },
    { "date": "2026-05-28", "claim": "$LPK thesis@$13→$24.2", "falsifiable": "价格可查", "verdict": "待核", "due": null, "note": "" },
    { "date": "2026-05-26", "claim": "$VPG 3x 但 ASP 建错", "falsifiable": "他自承", "verdict": "归因不稳", "due": null, "note": "已记 entity §4" },
    { "date": "2026-05-26", "claim": "$NVTS 已翻倍", "falsifiable": "价格可查", "verdict": "待核", "due": null, "note": "" },
    { "date": "2026-05-25", "claim": "$SIVE BlackRock/Vanguard/MSCI 被动流入 ~$60M+ next week", "falsifiable": "可查指数纳入公告", "verdict": "待核", "due": "2026-06-01", "note": "" },
    { "date": "2026-05-27", "claim": "EU Chips Act 2 正式公告 SIVE/SOI/XFAB 上 blueprint", "falsifiable": "公告可查", "verdict": "待核", "due": "2026-06-02", "note": "推迟到下周" },
    { "date": "2026-05-28", "claim": "CPO 大规模出货从 H2 2026 改口 H2 2027", "falsifiable": "口径已后延", "verdict": "待核", "due": "2027-07-01", "note": "" }
  ],
  "catalysts": [
    { "date": "~2026-06-01", "event": "$SIVE 指数被动流入(BlackRock/Vanguard/MSCI/OMX)+ NASDAQ 上市", "chain": "$SIVE" },
    { "date": "~2026-06-02", "event": "EU Chips Act 2 正式公告(含 SIVE/SOI/XFAB)", "chain": "欧洲光子链" },
    { "date": "2026-06-01", "event": "NVDA Computex Taipei keynote", "chain": "台湾全链" },
    { "date": "2026 Q2-Q4", "event": "$AAOI 营收模型 $312M→$1.41B 拐点", "chain": "TRANSCEIVER" },
    { "date": "3-10 月内", "event": "$JBL 1.6T LRO 量产", "chain": "$SIVE/TRANSCEIVER" },
    { "date": "H2 2027", "event": "CPO 大规模出货", "chain": "全链" }
  ]
}
```

- [ ] **Step 2: Validate JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('data/serenity/ledger.json','utf8')); console.log('valid')"`
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add data/serenity/ledger.json
git -c user.email=jiaxu@local commit -m "feat(serenity): seed ledger.json fixture from activity-ledger markdown"
```

---

## Task 4: KPI bar + holdings grid (server components)

**Files:**
- Create: `src/components/dashboard/serenity/kpi-bar.tsx`
- Create: `src/components/dashboard/serenity/holdings-grid.tsx`

- [ ] **Step 1: Write kpi-bar.tsx**

```tsx
// src/components/dashboard/serenity/kpi-bar.tsx
import type { Ledger } from "@/lib/serenity-reader"
import { TriangleAlert } from "lucide-react"

export function KpiBar({ ledger, tweetTotal }: { ledger: Ledger; tweetTotal: number }) {
  const active = ledger.positions.filter((p) => p.status === "active").length
  const newThisWeek = ledger.positions.filter((p) => p.stance === "新开").length
  const pending = ledger.predictions.filter((p) => p.verdict === "待核").length
  const cards = [
    { label: "活跃持仓", value: String(active) },
    { label: "本周新开", value: String(newThisWeek) },
    { label: "待核预测", value: String(pending) },
    { label: "推文总数", value: String(tweetTotal) },
  ]
  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <div className="text-xs text-zinc-500">{c.label}</div>
          <div className="mt-1 text-2xl font-semibold text-zinc-100">{c.value}</div>
        </div>
      ))}
      <div className="col-span-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 sm:col-span-4">
        <div className="flex items-center gap-2 text-xs text-amber-300">
          <TriangleAlert className="h-3.5 w-3.5" />
          自报 YTD {ledger.self_reported.ytd_pct}% / 2 年 {ledger.self_reported.two_year_pct}%
          <span className="rounded border border-amber-500/40 px-1">🚫 不可证伪</span>
          <span className="text-amber-400/70">截至 {ledger.self_reported.as_of}·IBKR 子账户口径非审计净值</span>
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Write holdings-grid.tsx**

```tsx
// src/components/dashboard/serenity/holdings-grid.tsx
import type { Position } from "@/lib/serenity-reader"

const STANCE_TONE: Record<string, string> = {
  新开: "border-emerald-500/40 bg-emerald-500/5 text-emerald-200",
  加码: "border-rose-500/40 bg-rose-500/5 text-rose-200",
  持有: "border-zinc-600/40 bg-zinc-700/10 text-zinc-200",
  减仓: "border-sky-500/40 bg-sky-500/5 text-sky-200",
  反手做空: "border-fuchsia-500/40 bg-fuchsia-500/5 text-fuchsia-200",
  转静默: "border-zinc-700/40 bg-zinc-800/20 text-zinc-400",
  观察: "border-yellow-500/30 bg-yellow-500/5 text-yellow-200",
}

const STANCE_ICON: Record<string, string> = {
  新开: "🆕", 加码: "🔥", 持有: "➡️", 减仓: "📉", 反手做空: "🔄", 转静默: "🤫", 观察: "👀",
}

export function HoldingsGrid({
  positions,
  onPickTicker,
}: {
  positions: Position[]
  onPickTicker?: (ticker: string) => void
}) {
  // Group by chain
  const byChain = new Map<string, Position[]>()
  for (const p of positions) {
    if (!byChain.has(p.chain)) byChain.set(p.chain, [])
    byChain.get(p.chain)!.push(p)
  }
  return (
    <section className="space-y-4">
      {Array.from(byChain.entries()).map(([chain, items]) => (
        <div key={chain}>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">{chain}</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((p) => (
              <div
                key={p.ticker}
                className={`rounded-xl border p-3 ${STANCE_TONE[p.stance] ?? STANCE_TONE.持有}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-semibold">${p.ticker}</span>
                  <span className="text-xs">{STANCE_ICON[p.stance] ?? ""} {p.stance}</span>
                </div>
                <div className="mt-1 text-[11px] text-zinc-400">{p.name} · {p.instrument}</div>
                <p className="mt-2 text-xs leading-relaxed text-zinc-300">{p.thesis}</p>
                <div className="mt-2 text-[10px] text-zinc-500">最近提及 {p.last_mention}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}
```

NOTE: `onPickTicker` is wired to the client drawer in Task 7; for now it's an optional prop and the cards render statically server-side.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in the two new files.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/serenity/kpi-bar.tsx src/components/dashboard/serenity/holdings-grid.tsx
git -c user.email=jiaxu@local commit -m "feat(serenity): KPI bar + holdings grid server components"
```

---

## Task 5: Hand-rolled SVG charts (server component)

**Files:**
- Create: `src/components/dashboard/serenity/charts.tsx`

- [ ] **Step 1: Write charts.tsx**

```tsx
// src/components/dashboard/serenity/charts.tsx
import type { Verdict } from "@/lib/serenity-reader"

const VERDICT_COLOR: Record<string, string> = {
  兑现: "#34d399", 落空: "#f87171", 待核: "#fbbf24", 不可证伪: "#71717a", 归因不稳: "#a78bfa",
}

export function PostVolumeChart({ data }: { data: { day: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count))
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <h3 className="mb-3 text-xs font-medium text-zinc-400">发推量(按天)</h3>
      <div className="flex h-28 items-end gap-1">
        {data.map((d) => (
          <div key={d.day} className="flex flex-1 flex-col items-center justify-end" title={`${d.day}: ${d.count}`}>
            <div className="w-full rounded-t bg-sky-500/60" style={{ height: `${(d.count / max) * 100}%` }} />
            <span className="mt-1 text-[8px] text-zinc-600">{d.day.slice(5)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function TickerHeatChart({ data }: { data: { ticker: string; count: number }[] }) {
  const top = data.slice(0, 12)
  const max = Math.max(1, ...top.map((d) => d.count))
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <h3 className="mb-3 text-xs font-medium text-zinc-400">ticker 提及热度</h3>
      <div className="space-y-1.5">
        {top.map((d) => (
          <div key={d.ticker} className="flex items-center gap-2">
            <span className="w-16 font-mono text-[11px] text-zinc-300">${d.ticker}</span>
            <div className="h-3 flex-1 rounded bg-zinc-900">
              <div className="h-3 rounded bg-rose-500/60" style={{ width: `${(d.count / max) * 100}%` }} />
            </div>
            <span className="w-6 text-right text-[10px] text-zinc-500">{d.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function VerdictDonut({ data }: { data: { verdict: Verdict; count: number }[] }) {
  const total = data.reduce((s, d) => s + d.count, 0) || 1
  let acc = 0
  const R = 40, C = 2 * Math.PI * R
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <h3 className="mb-3 text-xs font-medium text-zinc-400">预测判定分布</h3>
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 100 100" className="h-28 w-28 -rotate-90">
          {data.map((d) => {
            const frac = d.count / total
            const dash = `${frac * C} ${C}`
            const el = (
              <circle key={d.verdict} cx="50" cy="50" r={R} fill="none"
                stroke={VERDICT_COLOR[d.verdict] ?? "#71717a"} strokeWidth="14"
                strokeDasharray={dash} strokeDashoffset={-acc * C} />
            )
            acc += frac
            return el
          })}
        </svg>
        <ul className="space-y-1 text-[11px]">
          {data.map((d) => (
            <li key={d.verdict} className="flex items-center gap-1.5 text-zinc-300">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: VERDICT_COLOR[d.verdict] ?? "#71717a" }} />
              {d.verdict} <span className="text-zinc-500">{d.count}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/serenity/charts.tsx
git -c user.email=jiaxu@local commit -m "feat(serenity): hand-rolled SVG charts (volume/heat/verdict donut)"
```

---

## Task 6: Tweet browser (client component)

**Files:**
- Create: `src/components/dashboard/serenity/tweet-browser.tsx`

- [ ] **Step 1: Write tweet-browser.tsx**

```tsx
// src/components/dashboard/serenity/tweet-browser.tsx
"use client"
import { useMemo, useState } from "react"
import { filterTweets, type Tweet } from "@/lib/serenity-reader"

const PAGE = 30

export function TweetBrowser({ tweets }: { tweets: Tweet[] }) {
  const [q, setQ] = useState("")
  const [ticker, setTicker] = useState("")
  const [minLikes, setMinLikes] = useState(0)
  const [page, setPage] = useState(0)

  const filtered = useMemo(
    () => filterTweets(tweets, { q: q || undefined, ticker: ticker || undefined, minLikes: minLikes || undefined }),
    [tweets, q, ticker, minLikes],
  )
  const shown = filtered.slice(0, (page + 1) * PAGE)

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <h3 className="mb-3 text-xs font-medium text-zinc-400">推文浏览器 ({filtered.length})</h3>
      <div className="mb-3 flex flex-wrap gap-2">
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }}
          placeholder="搜正文…" className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200" />
        <input value={ticker} onChange={(e) => { setTicker(e.target.value); setPage(0) }}
          placeholder="ticker" className="w-24 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200" />
        <select value={minLikes} onChange={(e) => { setMinLikes(Number(e.target.value)); setPage(0) }}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200">
          <option value={0}>全部赞</option>
          <option value={100}>≥100</option>
          <option value={500}>≥500</option>
          <option value={1000}>≥1K</option>
        </select>
      </div>
      <ul className="space-y-2">
        {shown.map((t) => (
          <li key={t.id} className="rounded border border-zinc-800/60 p-2 text-xs">
            <div className="flex items-center justify-between text-[10px] text-zinc-500">
              <span>{t.timestamp.slice(0, 16).replace("T", " ")}</span>
              <a href={t.url} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">♥ {t.likesRaw} ↗</a>
            </div>
            <p className="mt-1 leading-relaxed text-zinc-200">{t.text}</p>
          </li>
        ))}
      </ul>
      {shown.length < filtered.length && (
        <button onClick={() => setPage((p) => p + 1)}
          className="mt-3 w-full rounded border border-zinc-700 py-1.5 text-xs text-zinc-400 hover:bg-zinc-900">
          加载更多 ({filtered.length - shown.length})
        </button>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/serenity/tweet-browser.tsx
git -c user.email=jiaxu@local commit -m "feat(serenity): client tweet browser with search/filter/paging"
```

---

## Task 7: Ticker drawer + wire holdings click (client)

**Files:**
- Create: `src/components/dashboard/serenity/ticker-drawer.tsx`
- Create: `src/components/dashboard/serenity/holdings-section.tsx` (client wrapper bridging grid → drawer)

- [ ] **Step 1: Write ticker-drawer.tsx**

```tsx
// src/components/dashboard/serenity/ticker-drawer.tsx
"use client"
import { filterTweets, type Tweet } from "@/lib/serenity-reader"
import { X } from "lucide-react"

export function TickerDrawer({ ticker, tweets, onClose }: { ticker: string | null; tweets: Tweet[]; onClose: () => void }) {
  if (!ticker) return null
  const hits = filterTweets(tweets, { ticker }).slice(0, 50)
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-mono text-sm text-zinc-100">${ticker} 原推 ({hits.length})</h3>
          <button onClick={onClose}><X className="h-4 w-4 text-zinc-400" /></button>
        </div>
        <ul className="space-y-2">
          {hits.map((t) => (
            <li key={t.id} className="rounded border border-zinc-800/60 p-2 text-xs">
              <div className="flex items-center justify-between text-[10px] text-zinc-500">
                <span>{t.timestamp.slice(0, 16).replace("T", " ")}</span>
                <a href={t.url} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">♥ {t.likesRaw} ↗</a>
              </div>
              <p className="mt-1 leading-relaxed text-zinc-200">{t.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write holdings-section.tsx (client wrapper)**

```tsx
// src/components/dashboard/serenity/holdings-section.tsx
"use client"
import { useState } from "react"
import type { Position, Tweet } from "@/lib/serenity-reader"
import { HoldingsGrid } from "./holdings-grid"
import { TickerDrawer } from "./ticker-drawer"

export function HoldingsSection({ positions, tweets }: { positions: Position[]; tweets: Tweet[] }) {
  const [ticker, setTicker] = useState<string | null>(null)
  return (
    <>
      <HoldingsGrid positions={positions} onPickTicker={setTicker} />
      <TickerDrawer ticker={ticker} tweets={tweets} onClose={() => setTicker(null)} />
    </>
  )
}
```

- [ ] **Step 3: Make holdings-grid cards clickable**

In `src/components/dashboard/serenity/holdings-grid.tsx`, change the card root `<div>` opening tag to call `onPickTicker`. Replace:

```tsx
              <div
                key={p.ticker}
                className={`rounded-xl border p-3 ${STANCE_TONE[p.stance] ?? STANCE_TONE.持有}`}
              >
```

with:

```tsx
              <button
                key={p.ticker}
                type="button"
                onClick={() => onPickTicker?.(p.ticker)}
                className={`rounded-xl border p-3 text-left ${STANCE_TONE[p.stance] ?? STANCE_TONE.持有} ${onPickTicker ? "cursor-pointer hover:brightness-125" : ""}`}
              >
```

And change the matching closing `</div>` of that card to `</button>`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/serenity/ticker-drawer.tsx src/components/dashboard/serenity/holdings-section.tsx src/components/dashboard/serenity/holdings-grid.tsx
git -c user.email=jiaxu@local commit -m "feat(serenity): ticker drawer + clickable holdings cards"
```

---

## Task 8: /serenity route (server page assembling all zones)

**Files:**
- Create: `src/app/serenity/page.tsx`

- [ ] **Step 1: Write page.tsx**

**Auth note:** Auth is enforced globally by `src/middleware.ts` (matcher covers all non-static paths; unauthenticated → redirect to `/auth/login`). The `/serenity` route needs NO inline auth gate — middleware protects it automatically, same as `/wife-mt4`. Do not import auth helpers in the page.

```tsx
// src/app/serenity/page.tsx
import {
  readLedger, readTweets,
  tweetCountByDay, tickerMentionCounts, verdictBreakdown,
  type Ledger,
} from "@/lib/serenity-reader"
import { KpiBar } from "@/components/dashboard/serenity/kpi-bar"
import { HoldingsSection } from "@/components/dashboard/serenity/holdings-section"
import { PostVolumeChart, TickerHeatChart, VerdictDonut } from "@/components/dashboard/serenity/charts"
import { TweetBrowser } from "@/components/dashboard/serenity/tweet-browser"

export const dynamic = "force-dynamic"

export default async function SerenityPage() {
  const [ledgerRes, tweetsRes] = await Promise.all([readLedger(), readTweets()])

  if (!ledgerRes.ok) {
    return (
      <main className="min-h-screen bg-zinc-950 p-6 text-sm text-rose-400">
        读 ledger.json 失败:{ledgerRes.error}
      </main>
    )
  }
  const ledger = ledgerRes.ledger
  const tweets = tweetsRes.ok ? tweetsRes.tweets : []

  // Recent window for charts (last 14 days of activity)
  const days = tweetCountByDay(tweets).slice(-14)
  const recentTweets = tweets.filter((t) => {
    const cutoff = ledger.last_distilled_ts.slice(0, 10)
    return t.timestamp.slice(0, 10) >= "2026-05-15" || cutoff === ""
  })
  const heat = tickerMentionCounts(recentTweets)
  const verdicts = verdictBreakdown(ledger.predictions)

  return (
    <main className="min-h-screen space-y-6 bg-zinc-950 p-4 sm:p-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold text-zinc-100">Serenity 盯仓台</h1>
        <span className="text-xs text-zinc-500">
          @aleabitoreddit · 蒸馏至 {ledger.updated} · 推文 {tweets.length}
          {!tweetsRes.ok && <span className="ml-2 text-rose-400">(corpus 读取失败)</span>}
        </span>
      </header>

      <KpiBar ledger={ledger} tweetTotal={tweets.length} />

      <HoldingsSection positions={ledger.positions} tweets={tweets} />

      <section className="grid gap-3 lg:grid-cols-3">
        <PostVolumeChart data={days} />
        <TickerHeatChart data={heat} />
        <VerdictDonut data={verdicts} />
      </section>

      <CatalystList ledger={ledger} />

      <TweetBrowser tweets={tweets} />
    </main>
  )
}

function CatalystList({ ledger }: { ledger: Ledger }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <h3 className="mb-3 text-xs font-medium text-zinc-400">前瞻 Catalyst 日历</h3>
      <ul className="space-y-1.5 text-xs">
        {ledger.catalysts.map((c, i) => (
          <li key={i} className="flex gap-3">
            <span className="w-24 flex-shrink-0 font-mono text-zinc-400">{c.date}</span>
            <span className="text-zinc-200">{c.event}</span>
            <span className="ml-auto text-zinc-500">{c.chain}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: build succeeds, `/serenity` route listed.

- [ ] **Step 3: Commit**

```bash
git add src/app/serenity/page.tsx
git -c user.email=jiaxu@local commit -m "feat(serenity): /serenity route assembling all dashboard zones"
```

---

## Task 9: Wire corpus mount + env + deploy

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add env var**

In `docker-compose.yml`, under `environment:`, after the `VAULT_DIR=/data/vault` line, add:

```yaml
      - SERENITY_CORPUS_DIR=/data/x-corpus
```

- [ ] **Step 2: Add corpus volume mount**

In `docker-compose.yml`, under `volumes:`, after the vault mount line, add:

```yaml
      # serenity dashboard — reads tweets-full.json + ledger.json (ro)
      - /data/x-exports/aleabitoreddit:/data/x-corpus:ro
```

- [ ] **Step 3: Seed live ledger.json into the corpus dir**

The seed fixture lives in repo (`data/serenity/ledger.json`); copy it into the mounted corpus dir so the live mount serves it until the next distillation overwrites it.

Run:
```bash
cp /programHost/vibe-coding/jiaxu-portal/data/serenity/ledger.json /data/x-exports/aleabitoreddit/ledger.json
ls -la /data/x-exports/aleabitoreddit/ledger.json
```
Expected: file present.

- [ ] **Step 4: Build + deploy**

Run:
```bash
cd /programHost/vibe-coding/jiaxu-portal && docker compose up -d --build --force-recreate
```
Expected: container recreated, healthy.

- [ ] **Step 5: Spot-check mount + route (per reference-docker-compose-build-silent-noop)**

Run:
```bash
docker exec jiaxu-portal ls /data/x-corpus/
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3200/serenity
```
Expected: `ledger.json  tweets-full.json` listed; HTTP `200` or `307`(auth redirect — both prove the route resolves).

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml
git -c user.email=jiaxu@local commit -m "feat(serenity): mount corpus + env, deploy dashboard"
```

---

## Task 10: Add portal service card entry + distillation SOP linkage

**Files:**
- Modify: `src/config/services-data.ts`
- Modify (vault): `wiki/notes/serenity-活账本.md` §4 SOP

- [ ] **Step 1: Add service card**

In `src/config/services-data.ts`, in the `my-projects` section array, add an entry. NOTE: `healthUrl` is **required** by `ServiceDefinition` (no `?`). For a relative portal sub-route, `getInternalUrl` already special-cases `url.startsWith("/")` to use the relative path directly; set `healthUrl` to the portal's own origin so the health check passes. Use icon `CandlestickChart` — it is **already** registered in `src/lib/icon-map.ts` (no icon-map edit needed; an unregistered name silently falls back to the Server icon via `resolveIcon`).

```typescript
  {
    id: "serenity-dashboard",
    name: "Serenity 盯仓台",
    description: "@aleabitoreddit 持仓追踪 + 预测对账 + 推文浏览",
    category: "my-projects",
    icon: "CandlestickChart",
    url: "/serenity",
    healthUrl: "http://127.0.0.1:3000/serenity",
    isOwn: true,
    tags: ["investing", "kol", "serenity"],
  },
```

- [ ] **Step 2: Update distillation SOP in vault (acquire lock first)**

Acquire vault lock, then add a step to `wiki/notes/serenity-活账本.md` §4 SOP between current steps 6 and 7:

```markdown
6.5. **写 dashboard 镜像**:把持仓表/对账表/catalyst 转成结构化 `ledger.json` 写到 `/data/x-exports/aleabitoreddit/ledger.json`(schema 见 jiaxu-portal `docs/superpowers/specs/2026-05-29-serenity-dashboard-design.md`)。markdown 给人看,JSON 给 portal /serenity 盯仓台,同一次蒸馏双吐
```

Commands:
```bash
echo "claude-$(date -Iseconds)" > /programHost/obsidian/jiaxu/.vault-writing-lock
# (edit the file)
rm -f /programHost/obsidian/jiaxu/.vault-writing-lock
```

- [ ] **Step 3: Typecheck + rebuild + redeploy**

Run:
```bash
cd /programHost/vibe-coding/jiaxu-portal && npx tsc --noEmit && docker compose up -d --build --force-recreate
```
Expected: success.

- [ ] **Step 4: Commit (both repos)**

```bash
cd /programHost/vibe-coding/jiaxu-portal
git add src/config/services-data.ts
git -c user.email=jiaxu@local commit -m "feat(serenity): portal service card entry"
cd /programHost/obsidian/jiaxu
git add wiki/notes/serenity-活账本.md
git -c user.email=jiaxu@local commit -m "docs(serenity): add ledger.json dual-write step to distillation SOP"
```

- [ ] **Step 5: Append log.md writeback entry (vault, lock first)**

Add to `log.md` per CLAUDE §6. Acquire lock, append:

```markdown
- 2026-05-29 writeback Serenity 盯仓台 dashboard 上线 — portal 子页 /serenity,JSON sidecar 架构
  - **新组件**:serenity-reader lib(ledger+corpus 读取/过滤/聚合,带 vitest)+ kpi-bar/holdings-grid/charts/tweet-browser/ticker-drawer + /serenity route
  - **数据**:ledger.json(策展持仓/对账/catalyst,蒸馏 SOP §6.5 双吐)+ tweets-full.json(corpus 挂 /data/x-corpus:ro)
  - **图表手搓 SVG 零依赖**;打假:自报 YTD 标 🚫不可证伪 badge
  - **联动**:[[serenity-活账本]] §4 SOP 加 ledger.json 写步;portal service card;plan/spec 在 jiaxu-portal docs/superpowers/
```

Then `rm -f .vault-writing-lock`.

---

## Self-Review Notes

- **Spec coverage:** KPI bar (Task 4) ✓ / holdings grid + drill-down (Task 4+7) ✓ / 3 charts (Task 5) ✓ / tweet browser (Task 6) ✓ / JSON sidecar reader (Task 1-2) ✓ / ledger schema (Task 3) ✓ / deploy + mount (Task 9) ✓ / SOP linkage (Task 10) ✓ / tests (Task 1-2) ✓.
- **Type consistency:** `Position`/`Prediction`/`Catalyst`/`Ledger`/`Tweet`/`Verdict`/`Stance` defined Task 1-2, reused verbatim Tasks 4-8. `filterTweets`/`tweetCountByDay`/`tickerMentionCounts`/`verdictBreakdown` signatures consistent across reader and consumers.
- **Charts library:** none added — confirmed hand-rolled SVG per spec.
- **Corrections applied after reading real source (post-draft):**
  - Task 8 auth: dropped speculative `getServerConfig()` — auth is enforced by `src/middleware.ts` globally; `/serenity` is protected automatically (verified). Page imports no auth helper.
  - Task 8 type: `CatalystList` now uses imported `Ledger` type (added to the page import) instead of inline `import(...)`.
  - Task 10 icon: use `CandlestickChart` (already in `icon-map.ts`) not `LineChart` (would need an icon-map edit + falls back to Server icon if missed). No icon-map change needed.
  - Task 10 service card: `healthUrl` is required by `ServiceDefinition`; set to portal origin. `getInternalUrl` special-cases relative `/serenity` url.
- **Known soft spots flagged for executor:**
  - The "recent window" cutoff in Task 8 uses a literal `2026-05-15`; acceptable for v1 (charts show recent activity) but a future refinement could derive it from `last_distilled_ts` minus N days.
  - `tweet-browser.tsx` imports `filterTweets` (a server-lib fn) into a client component — it's pure (no fs/node imports at call site), so it bundles fine, but the executor should confirm `serenity-reader.ts` does not top-level-execute any `node:fs` on import in a way that breaks client bundling. If it does, extract pure fns (`filterTweets`/`parseLikes`) into a `serenity-pure.ts` with no `node:fs` import and re-export. (The fs calls are inside `readLedger`/`readTweets` only, so this should be fine, but verify the build.)
