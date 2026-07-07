import { describe, it, expect } from "vitest"
import {
  replayOpenOrders,
  latestPredictionsByMarket,
  openPositions,
  buildOpenOrderRows,
  buildPositionRows,
  buildPredictionRows,
  buildSettlementRows,
  type OrderEvent,
  type Prediction,
  type Fill,
  type Settlement,
  type UniverseMarket,
} from "../pm-paper-detail-pure"

// replayOpenOrders is a direct port of executor.py's replay_open_orders —
// these cases mirror the semantics documented there: refresh replaces the
// prior open order on the same market; cancel/fill/expire close it.
describe("replayOpenOrders", () => {
  it("open → still open", () => {
    const events: OrderEvent[] = [
      { order_id: "o1", market_id: "m1", event: "open", ts: 1, side: "YES", limit: 0.5, shares: 200 },
    ]
    const open = replayOpenOrders(events)
    expect(open.size).toBe(1)
    expect(open.get("m1")?.order_id).toBe("o1")
  })

  it("refresh replaces the prior open order on the same market", () => {
    const events: OrderEvent[] = [
      { order_id: "o1", market_id: "m1", event: "open", ts: 1, side: "YES", limit: 0.5, shares: 200 },
      { order_id: "o2", market_id: "m1", event: "refresh", ts: 2, side: "YES", limit: 0.55, shares: 181 },
    ]
    const open = replayOpenOrders(events)
    expect(open.size).toBe(1)
    expect(open.get("m1")?.order_id).toBe("o2")
    expect(open.get("m1")?.limit).toBe(0.55)
  })

  it("cancel closes the order", () => {
    const events: OrderEvent[] = [
      { order_id: "o1", market_id: "m1", event: "open", ts: 1 },
      { order_id: "o1", market_id: "m1", event: "cancel", ts: 2 },
    ]
    expect(replayOpenOrders(events).size).toBe(0)
  })

  it("fill closes the order", () => {
    const events: OrderEvent[] = [
      { order_id: "o1", market_id: "m1", event: "open", ts: 1 },
      { order_id: "o1", market_id: "m1", event: "fill", ts: 2 },
    ]
    expect(replayOpenOrders(events).size).toBe(0)
  })

  it("expire closes the order", () => {
    const events: OrderEvent[] = [
      { order_id: "o1", market_id: "m1", event: "open", ts: 1 },
      { order_id: "o1", market_id: "m1", event: "expire", ts: 2 },
    ]
    expect(replayOpenOrders(events).size).toBe(0)
  })

  it("multiple markets tracked independently", () => {
    const events: OrderEvent[] = [
      { order_id: "o1", market_id: "m1", event: "open", ts: 1 },
      { order_id: "o2", market_id: "m2", event: "open", ts: 1 },
      { order_id: "o1", market_id: "m1", event: "cancel", ts: 2 },
    ]
    const open = replayOpenOrders(events)
    expect(open.size).toBe(1)
    expect(open.has("m1")).toBe(false)
    expect(open.has("m2")).toBe(true)
  })

  it("voided-by-retroactive-fill cancel (settler.py backfill) closes it same as any cancel", () => {
    const events: OrderEvent[] = [
      { order_id: "o1", market_id: "m1", event: "open", ts: 1 },
      { order_id: "o2", market_id: "m1", event: "refresh", ts: 5 },
      { order_id: "o2", market_id: "m1", event: "cancel", ts: 6, reason: "voided-by-retroactive-fill" },
    ]
    expect(replayOpenOrders(events).size).toBe(0)
  })
})

describe("latestPredictionsByMarket", () => {
  it("keeps only the highest-ts prediction per market", () => {
    const preds: Prediction[] = [
      { ts: 1, market_id: "m1", p: 0.3, confidence: "low", reasoning: "a", rules_notes: "", mid_at_prediction: 0.4 },
      { ts: 5, market_id: "m1", p: 0.6, confidence: "high", reasoning: "b", rules_notes: "", mid_at_prediction: 0.5 },
      { ts: 2, market_id: "m2", p: 0.1, confidence: "low", reasoning: "c", rules_notes: "", mid_at_prediction: 0.2 },
    ]
    const latest = latestPredictionsByMarket(preds)
    expect(latest.size).toBe(2)
    expect(latest.get("m1")?.p).toBe(0.6)
    expect(latest.get("m2")?.p).toBe(0.1)
  })
})

describe("openPositions", () => {
  const fills: Fill[] = [
    { order_id: "o1", market_id: "m1", fill_ts: 1, fill_price: 0.5, side: "YES", shares: 200 },
    { order_id: "o2", market_id: "m2", fill_ts: 2, fill_price: 0.3, side: "NO", shares: 300 },
  ]
  it("excludes markets that have already settled", () => {
    const settlements: Settlement[] = [
      { market_id: "m1", outcome: 1, resolve_ts: 10, filled: true, cost: 100, pnl: 50, p: 0.5, brier_claude: 0.1, brier_market: 0.2 },
    ]
    const open = openPositions(fills, settlements)
    expect(open.map((f) => f.market_id)).toEqual(["m2"])
  })
  it("keeps all fills when nothing has settled yet", () => {
    expect(openPositions(fills, [])).toHaveLength(2)
  })
})

const universe: Map<string, UniverseMarket> = new Map([
  ["m1", { id: "m1", question: "Will X happen?", cohort: "politics", rule_flag: "ok", rule_note: "clear" }],
  ["m2", { id: "m2", question: "Will Y happen?", cohort: "data", rule_flag: "rule_trap", rule_note: "trap" }],
])

describe("buildOpenOrderRows", () => {
  it("joins replayed open orders with universe question/cohort/rule_flag", () => {
    const events: OrderEvent[] = [
      { order_id: "o1", market_id: "m1", event: "open", ts: 100, side: "YES", limit: 0.6, shares: 166.67, usd: 100, mid_at_order: 0.58 },
    ]
    const rows = buildOpenOrderRows(events, universe)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      market_id: "m1", question: "Will X happen?", cohort: "politics", rule_flag: "ok",
      side: "YES", limit: 0.6,
    })
  })
  it("falls back to a placeholder question when the market isn't in universe", () => {
    const events: OrderEvent[] = [{ order_id: "o9", market_id: "m9", event: "open", ts: 1 }]
    const rows = buildOpenOrderRows(events, universe)
    expect(rows[0].question).toBe("(市场 m9)")
    expect(rows[0].cohort).toBeNull()
  })
  it("sorts newest-first", () => {
    const events: OrderEvent[] = [
      { order_id: "o1", market_id: "m1", event: "open", ts: 1 },
      { order_id: "o2", market_id: "m2", event: "open", ts: 5 },
    ]
    const rows = buildOpenOrderRows(events, universe)
    expect(rows.map((r) => r.market_id)).toEqual(["m2", "m1"])
  })
})

describe("buildPositionRows", () => {
  it("joins open (unsettled) fills with universe and computes cost", () => {
    const fills: Fill[] = [{ order_id: "o1", market_id: "m1", fill_ts: 10, fill_price: 0.5, side: "YES", shares: 200 }]
    const rows = buildPositionRows(fills, [], universe)
    expect(rows).toHaveLength(1)
    expect(rows[0].question).toBe("Will X happen?")
    expect(rows[0].cost).toBe(100)
  })
  it("excludes settled fills", () => {
    const fills: Fill[] = [{ order_id: "o1", market_id: "m1", fill_ts: 10, fill_price: 0.5, side: "YES", shares: 200 }]
    const settlements: Settlement[] = [
      { market_id: "m1", outcome: 1, resolve_ts: 20, filled: true, cost: 100, pnl: 100, p: 0.5, brier_claude: 0.1, brier_market: 0.2 },
    ]
    expect(buildPositionRows(fills, settlements, universe)).toHaveLength(0)
  })
})

describe("buildPredictionRows", () => {
  it("computes divergence = p - mid_at_prediction and joins rule_flag", () => {
    const preds: Prediction[] = [
      { ts: 1, market_id: "m1", p: 0.7, confidence: "high", reasoning: "r", rules_notes: "n", mid_at_prediction: 0.5, trigger: "new" },
      { ts: 1, market_id: "m2", p: 0.2, confidence: "low", reasoning: "r2", rules_notes: "n2", mid_at_prediction: 0.22 },
    ]
    const rows = buildPredictionRows(preds, universe)
    // sorted by |divergence| desc: m1 (0.2) before m2 (0.02)
    expect(rows.map((r) => r.market_id)).toEqual(["m1", "m2"])
    expect(rows[0].divergence).toBeCloseTo(0.2, 5)
    expect(rows[0].rule_flag).toBe("ok")
    expect(rows[0].trigger).toBe("new")
    expect(rows[1].trigger).toBeNull()
  })

  it("only keeps the latest prediction per market", () => {
    const preds: Prediction[] = [
      { ts: 1, market_id: "m1", p: 0.3, confidence: "low", reasoning: "old", rules_notes: "", mid_at_prediction: 0.3 },
      { ts: 9, market_id: "m1", p: 0.8, confidence: "high", reasoning: "new", rules_notes: "", mid_at_prediction: 0.5 },
    ]
    const rows = buildPredictionRows(preds, universe)
    expect(rows).toHaveLength(1)
    expect(rows[0].reasoning).toBe("new")
  })
})

describe("buildSettlementRows", () => {
  it("passes through settlement fields and sorts newest-first", () => {
    const settlements: Settlement[] = [
      { market_id: "m1", outcome: 1, resolve_ts: 5, filled: true, cost: 100, pnl: 20, p: 0.6, brier_claude: 0.1, brier_market: 0.2, cohort: "politics", question: "Q1" },
      { market_id: "m2", outcome: 0, resolve_ts: 15, filled: false, cost: 0, pnl: 0, p: 0.4, brier_claude: 0.16, brier_market: 0.18, cohort: "data", question: "Q2" },
    ]
    const rows = buildSettlementRows(settlements)
    expect(rows.map((r) => r.market_id)).toEqual(["m2", "m1"])
    expect(rows[0].question).toBe("Q2")
  })

  it("falls back to a placeholder question when missing", () => {
    const settlements: Settlement[] = [
      { market_id: "m9", outcome: 1, resolve_ts: 1, filled: true, cost: 1, pnl: 1, p: 0.5, brier_claude: 0.1, brier_market: 0.1 },
    ]
    expect(buildSettlementRows(settlements)[0].question).toBe("(市场 m9)")
  })
})
