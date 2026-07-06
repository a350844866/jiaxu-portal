import { describe, it, expect, vi, beforeEach } from "vitest"

// SECURITY CONTRACT: /api/logs/fe-errors 与 /api/logs* 同门禁——无有效会话必须 401,
// 不因"只是聚合数字"放宽(FE_ERROR 含 staffId/路由等生产数据)。
const { authedMock, summaryMock } = vi.hoisted(() => ({
  authedMock: vi.fn(async () => false),
  summaryMock: vi.fn(),
}))

vi.mock("../guard", () => ({ isAuthed: authedMock }))
vi.mock("@/lib/vlogs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vlogs")>()
  return { ...actual, feErrorSummary: summaryMock }
})
vi.mock("server-only", () => ({}))

import { GET } from "../fe-errors/route"
import { VlogsError } from "@/lib/vlogs-pure"

beforeEach(() => {
  authedMock.mockReset()
  summaryMock.mockReset()
})

describe("GET /api/logs/fe-errors", () => {
  it("未登录 → 401,不触发 vlogs 查询", async () => {
    authedMock.mockResolvedValue(false)
    const res = await GET()
    expect(res.status).toBe(401)
    expect(summaryMock).not.toHaveBeenCalled()
  })

  it("已登录 → 200 透传聚合摘要", async () => {
    authedMock.mockResolvedValue(true)
    const fake = { window: "24h", total: 3, users: 2, sigs: 1, parseFailed: 0, top: [] }
    summaryMock.mockResolvedValue(fake)
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(fake)
  })

  it("vlogs 故障 → 502 统一话术,不泄内部错误", async () => {
    authedMock.mockResolvedValue(true)
    summaryMock.mockRejectedValue(new VlogsError("forbidden", "vlogs 403"))
    const res = await GET()
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe("日志源暂不可达")
  })
})
