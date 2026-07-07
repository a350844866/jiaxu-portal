import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { readPmPaperSnapshot } from "../pm-paper-reader"

describe("readPmPaperSnapshot", () => {
  let dir: string
  const origEnv = process.env.PM_PAPER_STATE_DIR

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "pm-paper-test-"))
    process.env.PM_PAPER_STATE_DIR = dir
  })

  afterAll(async () => {
    if (origEnv === undefined) delete process.env.PM_PAPER_STATE_DIR
    else process.env.PM_PAPER_STATE_DIR = origEnv
  })

  it("空态: 全部文件缺失 → bootstrapping=true, 不抛错, 数字全部空占位", async () => {
    const snap = await readPmPaperSnapshot()
    expect(snap.ok).toBe(true)
    expect(snap.bootstrapping).toBe(true)
    expect(snap.halt).toBe(false)
    expect(snap.universeCount).toBeNull()
    expect(snap.predictionsCount).toBe(0)
    expect(snap.overall).toBeNull()
    expect(snap.cohorts).toEqual({ politics: null, data: null })
    expect(snap.bankroll).toBeNull()
    expect(snap.committed).toBeNull()
    expect(snap.available).toBeNull()
    expect(snap.generatedAt).toBeNull()
    expect(snap.ageSeconds).toBeNull()
  })

  it("HALT 哨兵文件存在 → halt=true(即便 stats.json 没写 halt 字段)", async () => {
    await fs.writeFile(path.join(dir, "HALT"), "drawdown 31%\n")
    const snap = await readPmPaperSnapshot()
    expect(snap.halt).toBe(true)
  })

  it("stats.json overall.halt=true 且无 HALT 文件 → halt 仍为 true", async () => {
    await fs.writeFile(
      path.join(dir, "stats.json"),
      JSON.stringify({
        generated: "2026-07-07T03:22:57Z",
        bankroll: 5000,
        overall: { n_settled_predictions: 1, n_settled_positions: 1, pnl: -1600, roi_on_cost: -0.32, brier_claude: 0.2, brier_market: 0.25, n_open_orders: 0, n_fills_total: 1, halt: true },
        cohorts: { politics: {}, data: {} },
        calibration: [],
      }),
    )
    const snap = await readPmPaperSnapshot()
    expect(snap.halt).toBe(true)
    expect(snap.overall?.halt).toBe(true)
  })

  it("正常态: stats/universe/predictions/bankroll 齐全 → 各字段正确解析", async () => {
    await fs.writeFile(
      path.join(dir, "stats.json"),
      JSON.stringify({
        generated: "2026-07-07T03:22:57Z",
        bankroll: 5000,
        overall: {
          n_settled_predictions: 42,
          n_settled_positions: 40,
          pnl: 123.45,
          roi_on_cost: 0.031,
          brier_claude: 0.18,
          brier_market: 0.22,
          n_open_orders: 5,
          n_fills_total: 38,
          halt: false,
        },
        cohorts: {
          politics: { n_settled_predictions: 30, n_settled_positions: 29, pnl: 100, roi_on_cost: 0.03, brier_claude: 0.17, brier_market: 0.2 },
          data: { n_settled_predictions: 12, n_settled_positions: 11, pnl: 23.45, roi_on_cost: 0.04, brier_claude: 0.2, brier_market: 0.25 },
        },
        calibration: [{ bucket: "0.5-0.6", n: 10, p_mean: 0.55, outcome_rate: 0.5 }],
      }),
    )
    await fs.writeFile(
      path.join(dir, "universe.json"),
      JSON.stringify({ updated: "2026-07-07T03:13:47Z", markets: [{ id: "1" }, { id: "2" }, { id: "3" }] }),
    )
    await fs.writeFile(
      path.join(dir, "predictions.jsonl"),
      ['{"market_id":"1","p":0.6}', '{"market_id":"2","p":0.4}', "", "  "].join("\n"),
    )
    await fs.writeFile(path.join(dir, "bankroll.json"), JSON.stringify({ ts: "2026-07-07T04:00:00Z", committed: 500, available: 4500 }))

    const snap = await readPmPaperSnapshot()
    expect(snap.bootstrapping).toBe(false)
    expect(snap.halt).toBe(false)
    expect(snap.bankroll).toBe(5000)
    expect(snap.committed).toBe(500)
    expect(snap.available).toBe(4500)
    expect(snap.universeCount).toBe(3)
    expect(snap.predictionsCount).toBe(2) // blank lines not counted
    expect(snap.overall?.pnl).toBe(123.45)
    expect(snap.overall?.brier_claude).toBe(0.18)
    expect(snap.overall?.brier_market).toBe(0.22)
    expect(snap.cohorts.politics?.n_settled_predictions).toBe(30)
    expect(snap.cohorts.data?.n_settled_predictions).toBe(12)
    expect(snap.calibration).toHaveLength(1)
    expect(snap.generatedAt).toBe("2026-07-07T03:22:57Z")
    expect(snap.ageSeconds).toBeGreaterThanOrEqual(0)
  })

  it("stats.json 损坏(非法 JSON) → 不抛错, overall/cohorts 退化为 null", async () => {
    await fs.writeFile(path.join(dir, "stats.json"), "{not valid json")
    await fs.writeFile(path.join(dir, "universe.json"), JSON.stringify({ updated: "x", markets: [] }))
    const snap = await readPmPaperSnapshot()
    expect(snap.ok).toBe(true)
    expect(snap.overall).toBeNull()
    expect(snap.cohorts).toEqual({ politics: null, data: null })
    // universe.json 仍然存在(即便 stats 坏了)→ 不算 bootstrapping
    expect(snap.bootstrapping).toBe(false)
    expect(snap.universeCount).toBe(0)
  })

  it("predictions.jsonl 存在但 stats/universe 都缺 → 仍不算 bootstrapping(已有预测活动)", async () => {
    await fs.writeFile(path.join(dir, "predictions.jsonl"), '{"market_id":"1"}\n')
    const snap = await readPmPaperSnapshot()
    expect(snap.bootstrapping).toBe(false)
    expect(snap.predictionsCount).toBe(1)
  })
})
