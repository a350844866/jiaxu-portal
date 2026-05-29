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
