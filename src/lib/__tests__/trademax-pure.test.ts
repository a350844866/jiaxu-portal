import { describe, it, expect } from "vitest"
import {
  parseServerTime, beijingHour, beijingDate, parseTradesCsv, performance,
  equityCurve, byDay, exitBuckets, stopStructure, concurrency, timing,
  riskProfile, parseLiveFeed, parseAccountBar, ruleSet, parseEntryAnalysis,
} from "../trademax-pure"

const HEADER =
  "ticket,open_time,type,size,symbol,open_price,sl,tp,close_time,close_price,commission,taxes,swap,profit,comment"

/** Shape mirrors real rows pulled from the WebTerminal history tab. */
const CSV = [
  HEADER,
  // plain stop-out (protective stop still on the loss side)
  "1,2026.08.03 07:49:06,buy,0.05,XAUUSD,4072.13,4068.00,4076.12,2026.08.03 07:52:18,4068.02,0.00,0.00,0.00,-20.55,[sl]",
  // partial close: parent leg (0.03) then remainder (0.02), same open time+price
  "2,2026.08.03 08:06:03,sell,0.03,XAUUSD,4061.28,4065.12,4056.89,2026.08.03 08:12:25,4057.24,0.00,0.00,0.00,12.12,to #3",
  "3,2026.08.03 08:06:03,sell,0.02,XAUUSD,4061.28,4065.12,4056.89,2026.08.03 08:15:50,4056.84,0.00,0.00,0.00,8.88,from #2[tp]",
  // breakeven lock at +0.50 — SL moved to the profit side, TP removed
  "4,2026.08.03 22:16:04,buy,0.05,XAUUSD,4054.73,4055.23,0.00,2026.08.03 22:26:16,4055.17,0.00,0.00,0.00,2.20,[sl]",
  "5,2026.08.04 01:00:00,buy,0.05,XAUUSD,4059.05,4059.55,0.00,2026.08.04 01:02:00,4059.54,0.00,0.00,0.00,2.45,[sl]",
  // full take-profit
  "6,2026.08.04 03:20:08,sell,0.05,XAUUSD,4048.88,4055.45,4042.62,2026.08.04 03:43:40,4042.52,0.00,0.00,0.00,31.80,[tp]",
  // pending order that never filled
  "7,2026.08.06 06:25:25,buy limit,10.00,XAUUSD,1000.00,0.00,0.00,2026.08.06 10:04:24,4256.45,0.00,0.00,0.00,0.00,cancelled2418684038",
].join("\n")

const parsed = parseTradesCsv(CSV)
const deals = parsed.deals

describe("parseServerTime / timezone", () => {
  it("reads broker time as GMT+3", () => {
    // 2026-08-03 07:49:06 GMT+3 == 04:49:06 UTC
    expect(parseServerTime("2026.08.03 07:49:06")).toBe(Date.UTC(2026, 7, 3, 4, 49, 6))
  })

  it("rejects malformed stamps", () => {
    expect(parseServerTime("")).toBeNull()
    expect(parseServerTime("2026-08-03 07:49")).toBeNull()
  })

  it("converts to Beijing (server + 5h)", () => {
    const ms = parseServerTime("2026.08.03 07:49:06") as number
    expect(beijingHour(ms)).toBe(12)
    expect(beijingDate(ms)).toBe("2026-08-03")
  })

  it("rolls the Beijing date forward for late server-evening fills", () => {
    const ms = parseServerTime("2026.08.03 22:16:04") as number
    expect(beijingHour(ms)).toBe(3)
    expect(beijingDate(ms)).toBe("2026-08-04")
  })
})

describe("parseTradesCsv", () => {
  it("splits filled deals from pending orders", () => {
    expect(deals).toHaveLength(6)
    expect(parsed.pending).toHaveLength(1)
    expect(parsed.pending[0]).toMatchObject({ ticket: "7", type: "buy limit", size: 10, price: 1000 })
  })

  it("signs the SL offset by direction", () => {
    // buy with SL below entry → protective (negative)
    expect(deals.find((d) => d.ticket === "1")!.slOffset).toBeCloseTo(-4.13, 2)
    // buy with SL above entry → locked profit (positive)
    expect(deals.find((d) => d.ticket === "4")!.slOffset).toBeCloseTo(0.5, 2)
    // sell with SL above entry → protective (negative)
    expect(deals.find((d) => d.ticket === "2")!.slOffset).toBeCloseTo(-3.84, 2)
  })

  it("treats a zero TP as absent rather than a price", () => {
    expect(deals.find((d) => d.ticket === "4")!.tp).toBeNull()
    expect(deals.find((d) => d.ticket === "6")!.tp).toBe(4042.62)
  })

  it("classifies exits and partial legs from the broker comment", () => {
    expect(deals.find((d) => d.ticket === "1")!.exit).toBe("sl")
    expect(deals.find((d) => d.ticket === "2")!.exit).toBe("partial-parent")
    expect(deals.find((d) => d.ticket === "2")!.isPartialParent).toBe(true)
    expect(deals.find((d) => d.ticket === "3")!.isPartialChild).toBe(true)
    expect(deals.find((d) => d.ticket === "6")!.exit).toBe("tp")
  })

  it("survives an empty file", () => {
    expect(parseTradesCsv("")).toEqual({ deals: [], pending: [], skipped: 0 })
  })
})

describe("performance", () => {
  const p = performance(deals)

  it("counts wins and losses", () => {
    expect(p.n).toBe(6)
    expect(p.wins).toBe(5)
    expect(p.losses).toBe(1)
    expect(p.winRate).toBeCloseTo(5 / 6, 5)
  })

  it("exposes the payoff ratio that a high win rate hides", () => {
    expect(p.avgWin).toBeCloseTo((12.12 + 8.88 + 2.2 + 2.45 + 31.8) / 5, 5)
    expect(p.avgLoss).toBeCloseTo(-20.55, 5)
    expect(p.payoff).toBeCloseTo(11.49 / 20.55, 3)
  })

  it("computes profit factor and expectancy", () => {
    expect(p.profitFactor).toBeCloseTo(57.45 / 20.55, 3)
    expect(p.expectancy).toBeCloseTo((57.45 - 20.55) / 6, 5)
  })
})

describe("equityCurve", () => {
  it("tracks balance, peak and max drawdown from the deposit", () => {
    const eq = equityCurve(deals, 500)
    expect(eq.start).toBe(500)
    expect(eq.end).toBeCloseTo(500 + 36.9, 5)
    // first deal is a loss, so the trough is below the deposit
    expect(eq.trough).toBeCloseTo(479.45, 5)
    expect(eq.maxDrawdown).toBeCloseTo(20.55, 5)
    expect(eq.returnPct).toBeCloseTo(36.9 / 500, 5)
  })

  it("orders points by close time, not open time", () => {
    const eq = equityCurve(deals, 500)
    const times = eq.points.map((p) => p.ms)
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })
})

describe("byDay", () => {
  it("groups on the Beijing date of the close", () => {
    const days = byDay(deals, 500)
    expect(days.map((d) => d.date)).toEqual(["2026-08-03", "2026-08-04"])
    expect(days[0].n).toBe(3)
    expect(days[0].wins).toBe(2)
  })
})

describe("exitBuckets", () => {
  it("attributes P&L to how the trade ended", () => {
    const b = exitBuckets(deals)
    const sl = b.find((x) => x.key === "sl")!
    const tp = b.find((x) => x.key === "tp")!
    expect(sl.n).toBe(3)
    expect(sl.sum).toBeCloseTo(-20.55 + 2.2 + 2.45, 5)
    expect(tp.n).toBe(2)
  })

  it("drops empty buckets so the chart has no dead rows", () => {
    expect(exitBuckets(deals).some((b) => b.n === 0)).toBe(false)
  })
})

describe("stopStructure", () => {
  const s = stopStructure(deals)

  it("finds the hard-coded breakeven lock level", () => {
    expect(s.lockLevel).toBeCloseTo(0.5, 2)
    expect(s.lockLevelCount).toBe(2)
    expect(s.movedToProfit).toBe(2)
    expect(s.stillProtective).toBe(4)
  })

  it("reports SL exits that were actually profitable", () => {
    expect(s.slExitsTotal).toBe(3)
    expect(s.slExitsProfitable).toBe(2)
  })

  it("contrasts trades that kept their TP against those that dropped it", () => {
    expect(s.withTp).toBe(4)
    expect(s.withoutTp).toBe(2)
    expect(s.withoutTpPnl).toBeCloseTo(4.65, 5)
  })

  it("derives initial risk from the un-moved stops only", () => {
    expect(s.medianInitialStop).toBeGreaterThan(3)
    expect(s.medianInitialStop).toBeLessThan(7)
    expect(s.medianRiskUsd).toBeCloseTo((s.medianInitialStop as number) * 0.05 * 100, 5)
  })
})

describe("concurrency", () => {
  it("does not count partial-close legs as真并发", () => {
    const c = concurrency(deals)
    expect(c.partialLegOverlaps).toBe(1)
    expect(c.trueOverlaps).toBe(0)
    expect(c.oneAtATime).toBe(true)
    expect(c.decisions).toBe(5)
  })

  it("does flag a genuine second position", () => {
    const withOverlap = parseTradesCsv([
      HEADER,
      "10,2026.08.03 10:00:00,buy,0.05,XAUUSD,4000.00,3995.00,4005.00,2026.08.03 11:00:00,4005.00,0,0,0,25.00,[tp]",
      "11,2026.08.03 10:30:00,sell,0.05,XAUUSD,4002.00,4007.00,3997.00,2026.08.03 11:30:00,3997.00,0,0,0,25.00,[tp]",
    ].join("\n")).deals
    const c = concurrency(withOverlap)
    expect(c.trueOverlaps).toBe(1)
    expect(c.oneAtATime).toBe(false)
  })
})

describe("timing", () => {
  it("bins entries by Beijing hour", () => {
    const t = timing(deals)
    expect(t.hourly[12]).toBe(1)   // 07:49 server → 12:49 Beijing
    expect(t.hourly[3]).toBe(1)    // 22:16 server → 03:16 Beijing
    expect(t.hourly.reduce((a, b) => a + b, 0)).toBe(6)
  })

  it("reports the median hold in minutes", () => {
    const t = timing(deals)
    expect(t.medianHoldMin).toBeGreaterThan(0)
  })
})

describe("riskProfile", () => {
  const s = stopStructure(deals)
  const r = riskProfile(deals, 846.63, s.medianRiskUsd, 500)

  it("uses the modal lot for notional and flags constant sizing", () => {
    expect(r.modalLot).toBe(0.05)
    expect(r.lotsConstant).toBe(true)
    expect(r.oversizedFills).toBe(0)
    expect(r.leverage).toBeGreaterThan(10)
  })

  it("reports leverage and risk against both the balance and the deposit", () => {
    // a grown balance flatters the leverage number; the sponsor's ratio is worse
    expect(r.leverageOnDeposit).toBeGreaterThan(r.leverage as number)
    expect(r.riskPctOnDeposit).toBeGreaterThan(r.riskPerTradePct as number)
  })

  it("catches a fill above the base lot instead of calling sizing constant", () => {
    const withBig = parseTradesCsv([
      HEADER,
      "20,2026.08.05 18:02:44,buy,0.05,XAUUSD,4257.34,4252.00,0.00,2026.08.05 18:10:00,4258.11,0,0,0,3.85,[sl]",
      "21,2026.08.05 18:04:33,buy,0.10,XAUUSD,4258.18,4254.21,0.00,2026.08.05 18:20:00,4254.14,0,0,0,-40.40,[sl]",
    ].join("\n")).deals
    const big = riskProfile(withBig, 846.63, 25, 500)
    expect(big.oversizedFills).toBe(1)
    expect(big.lotsConstant).toBe(false)
  })

  it("shows what a losing streak does to the balance", () => {
    expect(r.lossStreakLadder.map((l) => l.n)).toEqual([3, 5, 10])
    expect(r.lossStreakLadder[0].balance).toBeLessThan(846.63)
  })

  it("keeps the sample-size bar honest", () => {
    expect(r.sampleProgress.need).toBe(200)
    expect(r.sampleProgress.pct).toBeCloseTo(6 / 200, 5)
  })
})

describe("parseAccountBar", () => {
  it("reads the MT4 status line including nbsp separators", () => {
    const bar = parseAccountBar("Balance: 846.63 USD  Equity: 850.00  Free margin: 800.10")
    expect(bar).toEqual({ balance: 846.63, equity: 850, freeMargin: 800.1 })
  })
})

describe("parseLiveFeed", () => {
  const jsonl = [
    JSON.stringify({ t: "2026-08-06T07:20:00+00:00", rows: [["Balance: 846.63 USD  Equity: 846.63  Free margin: 846.63", "0.00", ""]] }),
    JSON.stringify({ t: "2026-08-06T07:21:00+00:00", rows: [
      ["99", "2026.08.06 10:20:00", "buy", "0.05", "XAUUSD", "4250.00", "4245.00", "4255.00", "4250.50", "0.00", "0.00", "0.00", "2.50", ""],
      ["Balance: 846.63 USD  Equity: 849.13  Free margin: 800.00", "2.50", ""],
    ] }),
    JSON.stringify({ t: "2026-08-06T07:22:00+00:00", rows: [
      ["99", "2026.08.06 10:20:00", "buy", "0.05", "XAUUSD", "4250.00", "4250.50", "0.00", "4251.20", "0.00", "0.00", "0.00", "6.00", ""],
      ["Balance: 846.63 USD  Equity: 852.63  Free margin: 800.00", "6.00", ""],
    ] }),
  ].join("\n")

  it("labels open / sl-move events and keeps newest first", () => {
    const feed = parseLiveFeed(jsonl)
    expect(feed).toHaveLength(3)
    expect(feed[0].kind).toBe("sl-move")
    expect(feed[0].note).toContain("4245 → 4250.5")
    expect(feed[0].note).toContain("+0.50")
    expect(feed[1].kind).toBe("open")
    expect(feed[2].kind).toBe("flat")
  })

  it("parses the open position alongside the account bar", () => {
    const feed = parseLiveFeed(jsonl)
    expect(feed[0].positions).toHaveLength(1)
    expect(feed[0].positions[0]).toMatchObject({ ticket: "99", sl: 4250.5, tp: null })
    expect(feed[0].bar.equity).toBe(852.63)
  })

  it("ignores unparseable lines instead of throwing", () => {
    expect(() => parseLiveFeed("not json\n{}\n")).not.toThrow()
  })
})

describe("ruleSet", () => {
  it("computes its evidence strings from the data, not from constants", () => {
    const s = stopStructure(deals)
    const c = concurrency(deals)
    const r = riskProfile(deals, 846.63, s.medianRiskUsd)
    const rules = ruleSet(deals, s, c, r, timing(deals))
    expect(rules).toHaveLength(11)
    expect(rules[0].rule).toContain("XAUUSD")
    expect(rules[5].rule).toContain("+0.50")
    expect(rules[5].evidence).toContain(`${s.lockLevelCount} 笔`)
    // the entry trigger is explicitly *not* claimed
    expect(rules[10].confidence).toBe("unknown")
  })
})

describe("parseEntryAnalysis", () => {
  const raw = {
    generated_at: "2026-08-06T08:13:54+00:00",
    decisions: 72, aligned: 72, baseline_samples: 4320,
    trend_agreement: { "5": 0.944, "30": 0.958, "15": 0.847 },
    features: [
      { key: "ret30", label: "前30分钟位移", real: 7.686, base: -0.137, z: 7.44 },
      { key: "atr14", label: "ATR14(波动率)", real: 1.943, base: 1.912, z: 0.32 },
    ],
    clock: { seconds_in_first5: 9, minute_mod5: 15, minute_mod15: 6, n: 72 },
    pullback: { dist_ext30_median: 1.38, atr_median: 1.68, dist_in_atr: 0.82,
                already_broken: 1, within_1atr: 43, n: 72 },
    gaps: { median_min: 32, under2min: 11, n: 71 },
  }

  it("normalises the python artifact and sorts trend windows", () => {
    const e = parseEntryAnalysis(raw)!
    expect(e.decisions).toBe(72)
    expect(e.trendAgreement.map((t) => t.window)).toEqual([5, 15, 30])
    expect(e.features[0].z).toBeCloseTo(7.44, 2)
    expect(e.pullback.alreadyBroken).toBe(1)
  })

  it("returns null for junk instead of throwing", () => {
    expect(parseEntryAnalysis(null)).toBeNull()
    expect(parseEntryAnalysis({})).toBeNull()
    expect(parseEntryAnalysis({ features: "nope" })).toBeNull()
  })

  it("upgrades rule 11 and adds rule 12 once the entry artifact exists", () => {
    const s = stopStructure(deals)
    const c = concurrency(deals)
    const r = riskProfile(deals, 846.63, s.medianRiskUsd, 500)
    const withEntry = ruleSet(deals, s, c, r, timing(deals), parseEntryAnalysis(raw))
    expect(withEntry).toHaveLength(12)
    expect(withEntry[10].confidence).toBe("medium")
    expect(withEntry[10].rule).toContain("回抽")
    expect(withEntry[10].evidence).toContain("96%")
    expect(withEntry[11].evidence).toContain("9/72")

    const without = ruleSet(deals, s, c, r, timing(deals), null)
    expect(without).toHaveLength(11)
    expect(without[10].confidence).toBe("unknown")
  })
})
