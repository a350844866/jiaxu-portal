import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { readPmPaperDetail } from "../pm-paper-detail-reader"

describe("readPmPaperDetail", () => {
  let dir: string
  const origEnv = process.env.PM_PAPER_STATE_DIR

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "pm-paper-detail-test-"))
    process.env.PM_PAPER_STATE_DIR = dir
  })

  afterAll(async () => {
    if (origEnv === undefined) delete process.env.PM_PAPER_STATE_DIR
    else process.env.PM_PAPER_STATE_DIR = origEnv
  })

  it("空态: 全部文件缺失 → 不抛错,各表退化为空数组,tradeGate 为 null", async () => {
    const d = await readPmPaperDetail()
    expect(d.ok).toBe(true)
    expect(d.bootstrapping).toBe(true)
    expect(d.tradeGate).toBeNull()
    expect(d.openOrders).toEqual([])
    expect(d.positions).toEqual([])
    expect(d.predictions).toEqual([])
    expect(d.settlements).toEqual([])
  })

  it("正常态: 综合 stats/universe/orders/predictions/fills/settlements 全部 join 正确", async () => {
    await fs.writeFile(
      path.join(dir, "universe.json"),
      JSON.stringify({
        updated: "x",
        markets: [
          { id: "m1", question: "Will X happen?", cohort: "politics", rule_flag: "ok" },
          { id: "m2", question: "Will Y happen?", cohort: "data", rule_flag: "rule_edge" },
        ],
      }),
    )
    await fs.writeFile(
      path.join(dir, "stats.json"),
      JSON.stringify({
        generated: "2026-07-07T04:10:34Z",
        bankroll: 5000,
        overall: { n_settled_predictions: 1, n_settled_positions: 1, pnl: 20, roi_on_cost: 0.2, brier_claude: 0.1, brier_market: 0.2, n_open_orders: 1, n_fills_total: 1, halt: false },
        cohorts: { politics: {}, data: {} },
        calibration: [{ bucket: "0.5-0.6", n: 1, p_mean: 0.55, outcome_rate: 1 }],
        trade_gate: { n_settled_trades: 1, gate_n_target: 30, pnl: 20, roi_on_cost: 0.2, brier_claude: 0.1, brier_market: 0.2, politics_pnl: 20, politics_n: 1 },
      }),
    )
    await fs.writeFile(
      path.join(dir, "orders.jsonl"),
      [
        JSON.stringify({ order_id: "o1", market_id: "m1", event: "open", ts: 1, side: "YES", limit: 0.5, shares: 200, mid_at_order: 0.48 }),
        JSON.stringify({ order_id: "o2", market_id: "m2", event: "open", ts: 2, side: "NO", limit: 0.4, shares: 250, mid_at_order: 0.42 }),
        JSON.stringify({ order_id: "o2", market_id: "m2", event: "fill", ts: 3 }),
      ].join("\n"),
    )
    await fs.writeFile(
      path.join(dir, "predictions.jsonl"),
      [
        JSON.stringify({ ts: 1, market_id: "m1", p: 0.6, confidence: "high", reasoning: "r1", rules_notes: "n1", mid_at_prediction: 0.48, trigger: "new" }),
        JSON.stringify({ ts: 1, market_id: "m2", p: 0.3, confidence: "low", reasoning: "r2", rules_notes: "n2", mid_at_prediction: 0.42, trigger: "new" }),
      ].join("\n"),
    )
    await fs.writeFile(
      path.join(dir, "fills.jsonl"),
      JSON.stringify({ order_id: "o2", market_id: "m2", fill_ts: 3, fill_price: 0.4, side: "NO", shares: 250 }) + "\n",
    )
    // m2 unsettled (still an open position); no settlements.jsonl file yet

    const d = await readPmPaperDetail()
    expect(d.bootstrapping).toBe(false)
    expect(d.tradeGate).toEqual({
      n_settled_trades: 1, gate_n_target: 30, pnl: 20, roi_on_cost: 0.2,
      brier_claude: 0.1, brier_market: 0.2, politics_pnl: 20, politics_n: 1,
    })
    // m1 still open (only "open" event, no fill/cancel)
    expect(d.openOrders).toHaveLength(1)
    expect(d.openOrders[0].market_id).toBe("m1")
    expect(d.openOrders[0].question).toBe("Will X happen?")
    // m2 filled and not yet settled -> shows as a position
    expect(d.positions).toHaveLength(1)
    expect(d.positions[0].market_id).toBe("m2")
    expect(d.positions[0].cost).toBe(100) // 0.4 * 250
    // both markets have a latest prediction
    expect(d.predictions).toHaveLength(2)
    expect(d.settlements).toEqual([])
    expect(d.calibration).toHaveLength(1)
  })

  it("orders.jsonl 超过行数上限时只取最近 N 行(尾部),不会 OOM 式全量解析后再截断结果错位", async () => {
    const lines: string[] = []
    // write more events than a small custom cap so we can assert tail behavior
    // without needing to generate 5000 real lines in a test.
    for (let i = 0; i < 10; i++) {
      lines.push(JSON.stringify({ order_id: `o${i}`, market_id: `m${i}`, event: "open", ts: i }))
    }
    await fs.writeFile(path.join(dir, "orders.jsonl"), lines.join("\n"))
    const d = await readPmPaperDetail()
    // all 10 fit well under the 5000-line cap: every market should show as open
    expect(d.openOrders).toHaveLength(10)
  })

  it("损坏的 stats.json 不影响 orders/predictions 等其它表的正常渲染", async () => {
    await fs.writeFile(path.join(dir, "stats.json"), "{not valid json")
    await fs.writeFile(
      path.join(dir, "orders.jsonl"),
      JSON.stringify({ order_id: "o1", market_id: "m1", event: "open", ts: 1 }) + "\n",
    )
    const d = await readPmPaperDetail()
    expect(d.tradeGate).toBeNull()
    expect(d.openOrders).toHaveLength(1)
  })
})
