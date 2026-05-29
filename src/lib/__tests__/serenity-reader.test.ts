import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { parseLikes, parseLedger, readLedger, readTweets, type Ledger } from "../serenity-reader"
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

describe("parseLedger coercion (hardening)", () => {
  it("defaults present-but-non-array fields to []", () => {
    const l = parseLedger(JSON.stringify({ positions: "nope", predictions: {}, catalysts: 5 }))
    expect(l.positions).toEqual([])
    expect(l.predictions).toEqual([])
    expect(l.catalysts).toEqual([])
  })

  it("clamps unknown stance/verdict/status to a safe fallback", () => {
    const l = parseLedger(JSON.stringify({
      positions: [{ ticker: "X", stance: "清仓", status: "open" }],
      predictions: [{ verdict: "maybe" }],
    }))
    expect(l.positions[0].stance).toBe("观察")
    expect(l.positions[0].status).toBe("watch")
    expect(l.predictions[0].verdict).toBe("待核")
  })

  it("keeps valid enum values untouched", () => {
    const l = parseLedger(JSON.stringify({
      positions: [{ ticker: "X", stance: "加码", status: "active" }],
      predictions: [{ verdict: "兑现" }],
    }))
    expect(l.positions[0].stance).toBe("加码")
    expect(l.positions[0].status).toBe("active")
    expect(l.predictions[0].verdict).toBe("兑现")
  })

  it("coerces a partial self_reported field-by-field (no undefined leak)", () => {
    const l = parseLedger(JSON.stringify({ self_reported: { ytd_pct: 5 } }))
    expect(l.self_reported).toEqual({ ytd_pct: 5, two_year_pct: 0, as_of: "" })
  })
})

describe("readLedger / readTweets (IO layer)", () => {
  let dir: string
  const origEnv = process.env.SERENITY_CORPUS_DIR

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "serenity-test-"))
    process.env.SERENITY_CORPUS_DIR = dir
  })
  afterAll(async () => {
    if (origEnv === undefined) delete process.env.SERENITY_CORPUS_DIR
    else process.env.SERENITY_CORPUS_DIR = origEnv
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("readLedger returns {ok:true} with ageSeconds for a well-formed file", async () => {
    await fs.writeFile(path.join(dir, "ledger.json"), JSON.stringify({
      updated: "2026-05-29", positions: [], predictions: [], catalysts: [],
    }))
    const r = await readLedger()
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.ledger.updated).toBe("2026-05-29")
      expect(r.ageSeconds).toBeGreaterThanOrEqual(0)
    }
  })

  it("readLedger returns {ok:false} (does not throw) when the file is missing", async () => {
    await fs.rm(path.join(dir, "ledger.json"), { force: true })
    const r = await readLedger()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBeTruthy()
  })

  it("readTweets reads a bare-array corpus and applies parseLikes", async () => {
    await fs.writeFile(path.join(dir, "tweets-full.json"), JSON.stringify([
      { id: "1", text: "$SIVE", timestamp: "2026-05-28T10:00:00Z", likes: "1.2K", url: "https://x.com/a/1" },
    ]))
    const r = await readTweets()
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.tweets).toHaveLength(1)
      expect(r.tweets[0].likes).toBe(1200)
      expect(r.tweets[0].likesRaw).toBe("1.2K")
    }
  })

  it("readTweets reads a {tweets:[...]} wrapper and coerces missing fields", async () => {
    await fs.writeFile(path.join(dir, "tweets-full.json"), JSON.stringify({ tweets: [{}] }))
    const r = await readTweets()
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.tweets[0]).toEqual({ id: "", text: "", timestamp: "", likes: 0, likesRaw: "0", url: "" })
    }
  })

  it("readTweets returns {ok:false} on malformed JSON", async () => {
    await fs.writeFile(path.join(dir, "tweets-full.json"), "{not json")
    const r = await readTweets()
    expect(r.ok).toBe(false)
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
  it("tickerMentionCounts counts a ticker repeated within one tweet only once", () => {
    const t: Tweet[] = [
      { id: "a", text: "$SIVE $SIVE again $SIVE", timestamp: "2026-05-28T10:00:00.000Z", likes: 1, likesRaw: "1", url: "" },
    ]
    expect(tickerMentionCounts(t)).toEqual([{ ticker: "SIVE", count: 1 }])
  })
  it("verdictBreakdown tallies prediction verdicts", () => {
    const preds = [
      { date: "", claim: "", falsifiable: "", verdict: "待核" as const, due: null, note: "" },
      { date: "", claim: "", falsifiable: "", verdict: "待核" as const, due: null, note: "" },
      { date: "", claim: "", falsifiable: "", verdict: "不可证伪" as const, due: null, note: "" },
    ]
    expect(verdictBreakdown(preds)).toContainEqual({ verdict: "待核", count: 2 })
    expect(verdictBreakdown(preds)).toContainEqual({ verdict: "不可证伪", count: 1 })
    expect(verdictBreakdown(preds)).toHaveLength(2)
  })
})
