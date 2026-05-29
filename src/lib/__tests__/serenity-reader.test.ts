import { describe, it, expect } from "vitest"
import { parseLikes, parseLedger, type Ledger } from "../serenity-reader"
import { filterTweets, tweetCountByDay, tickerMentionCounts, verdictBreakdown, type Tweet } from "../serenity-reader"

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

describe("parseLedger defaulting", () => {
  it("defaults missing fields to empty arrays + zeroed self_reported", () => {
    const l = parseLedger("{}")
    expect(l.positions).toEqual([])
    expect(l.predictions).toEqual([])
    expect(l.catalysts).toEqual([])
    expect(l.self_reported).toEqual({ ytd_pct: 0, two_year_pct: 0, as_of: "" })
  })
})

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
