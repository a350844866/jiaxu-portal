import { describe, it, expect, vi, beforeEach } from "vitest"

// No session guard here by design (same treatment as /api/pm-paper and
// /api/token/live). Route logic under test: pass through the detail
// snapshot, or 503 on throw without leaking internals.
const { readMock } = vi.hoisted(() => ({ readMock: vi.fn() }))

vi.mock("@/lib/pm-paper-detail-reader", () => ({ readPmPaperDetail: readMock }))

import { GET } from "../route"

beforeEach(() => {
  readMock.mockReset()
})

describe("GET /api/pm-paper/detail", () => {
  it("正常态 → 200 透传完整 detail payload", async () => {
    const fake = {
      ok: true,
      bootstrapping: false,
      generatedAt: "2026-07-07T04:10:34Z",
      ageSeconds: 30,
      halt: false,
      bankroll: 5000,
      committed: 100,
      available: 4900,
      universeCount: 49,
      universeUpdated: "x",
      predictionsCount: 49,
      overall: { n_settled_predictions: 0, n_settled_positions: 0, pnl: 0, roi_on_cost: null, brier_claude: null, brier_market: null },
      cohorts: { politics: null, data: null },
      calibration: [],
      tradeGate: { n_settled_trades: 0, gate_n_target: 30, pnl: 0, roi_on_cost: null, brier_claude: null, brier_market: null, politics_pnl: 0, politics_n: 0 },
      openOrders: [],
      positions: [],
      predictions: [],
      settlements: [],
    }
    readMock.mockResolvedValue(fake)
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(fake)
  })

  it("reader 抛错 → 503 统一话术,不泄内部错误细节", async () => {
    readMock.mockRejectedValue(new Error("EACCES: permission denied, open '/data/pm-paper/state/orders.jsonl'"))
    const res = await GET()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe("pm-paper 详情读取失败")
    expect(JSON.stringify(body)).not.toContain("EACCES")
  })
})
