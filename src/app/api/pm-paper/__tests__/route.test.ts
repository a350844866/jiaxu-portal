import { describe, it, expect, vi, beforeEach } from "vitest"

// No session guard here by design (same treatment as /api/token/live — relies
// on the global proxy.ts middleware, not added to PUBLIC_PATHS). Route logic
// under test is purely: pass through the reader snapshot, or 503 on throw.
const { readMock } = vi.hoisted(() => ({ readMock: vi.fn() }))

vi.mock("@/lib/pm-paper-reader", () => ({ readPmPaperSnapshot: readMock }))

import { GET } from "../route"

beforeEach(() => {
  readMock.mockReset()
})

describe("GET /api/pm-paper", () => {
  it("正常态 → 200 透传 snapshot", async () => {
    const fake = {
      ok: true,
      bootstrapping: false,
      generatedAt: "2026-07-07T03:22:57Z",
      ageSeconds: 120,
      halt: false,
      bankroll: 5000,
      committed: null,
      available: null,
      universeCount: 50,
      universeUpdated: "2026-07-07T03:13:47Z",
      predictionsCount: 12,
      overall: {
        n_settled_predictions: 0,
        n_settled_positions: 0,
        pnl: 0,
        roi_on_cost: null,
        brier_claude: null,
        brier_market: null,
      },
      cohorts: { politics: null, data: null },
      calibration: [],
    }
    readMock.mockResolvedValue(fake)
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(fake)
  })

  it("空态(文件缺失): reader 返回 bootstrapping=true 依然 200 直传", async () => {
    const fake = {
      ok: true,
      bootstrapping: true,
      generatedAt: null,
      ageSeconds: null,
      halt: false,
      bankroll: null,
      committed: null,
      available: null,
      universeCount: null,
      universeUpdated: null,
      predictionsCount: 0,
      overall: null,
      cohorts: { politics: null, data: null },
      calibration: [],
    }
    readMock.mockResolvedValue(fake)
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.bootstrapping).toBe(true)
  })

  it("HALT 态: reader 返回 halt=true 照常 200(卡片自己渲染红条)", async () => {
    readMock.mockResolvedValue({
      ok: true,
      bootstrapping: false,
      generatedAt: "2026-07-07T04:00:00Z",
      ageSeconds: 10,
      halt: true,
      bankroll: 3400,
      committed: 0,
      available: 3400,
      universeCount: 50,
      universeUpdated: "x",
      predictionsCount: 80,
      overall: { n_settled_predictions: 40, n_settled_positions: 40, pnl: -1600, roi_on_cost: -0.32, brier_claude: 0.3, brier_market: 0.22, n_open_orders: 0, n_fills_total: 40, halt: true },
      cohorts: { politics: null, data: null },
      calibration: [],
    })
    const res = await GET()
    const body = await res.json()
    expect(body.halt).toBe(true)
  })

  it("reader 抛错 → 503 统一话术,不泄内部错误细节", async () => {
    readMock.mockRejectedValue(new Error("EACCES: permission denied, open '/data/pm-paper/state/stats.json'"))
    const res = await GET()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe("pm-paper 状态读取失败")
    expect(JSON.stringify(body)).not.toContain("EACCES")
  })
})
