import { describe, it, expect } from "vitest"
import { aggregateFeErrors, buildFeErrorsLogsQL } from "../fe-errors-pure"

function ndLine(tUtc: string, payload: Record<string, unknown>): string {
  const msg = `2026-07-06 10:55:11.006  WARN [golden-service-web,abc,abc] 7 --- [nio-8084-exec-3] c.j.t.g.s.w.core.felog.FeLogController   : FE_ERROR ${JSON.stringify(payload)}\n`
  return JSON.stringify({ _time: tUtc, _msg: msg })
}

const EV = {
  app: "golden-service-vue-web",
  type: "vue",
  message: "Cannot read null",
  route: "/apply/list",
  component: "MyForm",
  staffId: "staff-1",
  sig: "sigA",
  count: 1,
}

describe("buildFeErrorsLogsQL", () => {
  it("固定 24h 窗口 + FE_ERROR 短语 + limit", () => {
    const q = buildFeErrorsLogsQL()
    expect(q).toContain("_time:24h")
    expect(q).toContain('"FE_ERROR"')
    expect(q).toContain("| limit")
  })
})

describe("aggregateFeErrors", () => {
  it("同 sig 聚合:count 求和、人数去重、lastSeen 取最大 _time 的样本", () => {
    const nd = [
      ndLine("2026-07-06T01:00:00Z", { ...EV, count: 1, staffId: "staff-1" }),
      ndLine("2026-07-06T03:00:00Z", {
        ...EV,
        count: 3,
        staffId: "staff-2",
        message: "Cannot read null v2",
        route: "/apply/detail",
      }),
      ndLine("2026-07-06T02:00:00Z", { ...EV, sig: "sigB", type: "api", staffId: "staff-1" }),
    ].join("\n")

    const s = aggregateFeErrors(nd)
    expect(s.total).toBe(5)
    expect(s.users).toBe(2)
    expect(s.sigs).toBe(2)
    expect(s.parseFailed).toBe(0)
    expect(s.top[0].sig).toBe("sigA")
    expect(s.top[0].count).toBe(4)
    expect(s.top[0].users).toBe(2)
    // lastSeen 应取 03:00 那条的样本字段
    expect(s.top[0].message).toBe("Cannot read null v2")
    expect(s.top[0].route).toBe("/apply/detail")
    expect(s.top[0].lastSeenUtc).toBe("2026-07-06T03:00:00Z")
    expect(s.top[0].lastSeenLocal).toBe("2026-07-06 11:00:00")
    expect(s.top[1].sig).toBe("sigB")
  })

  it("payload 坏 JSON → parseFailed 计数并跳过,不炸", () => {
    const bad = JSON.stringify({
      _time: "2026-07-06T01:00:00Z",
      _msg: "... FE_ERROR {broken json",
    })
    const s = aggregateFeErrors([bad, ndLine("2026-07-06T02:00:00Z", EV)].join("\n"))
    expect(s.parseFailed).toBe(1)
    expect(s.total).toBe(1)
  })

  it("整行坏 NDJSON → parseFailed;无 FE_ERROR 标记的行 → 静默忽略", () => {
    const noMarker = JSON.stringify({
      _time: "2026-07-06T01:00:00Z",
      _msg: "... FE_ERROR_ENDPOINT_FAIL something",
    })
    const s = aggregateFeErrors(["{not ndjson", noMarker].join("\n"))
    expect(s.parseFailed).toBe(1)
    expect(s.total).toBe(0)
    expect(s.sigs).toBe(0)
  })

  it("count=0/缺失按 1 计;缺 sig 归 (no-sig)", () => {
    const s = aggregateFeErrors(
      ndLine("2026-07-06T01:00:00Z", { ...EV, count: 0, sig: undefined })
    )
    expect(s.total).toBe(1)
    expect(s.top[0].sig).toBe("(no-sig)")
  })

  it("top 按次数降序截断到 8", () => {
    const lines = Array.from({ length: 12 }, (_, i) =>
      ndLine("2026-07-06T01:00:00Z", { ...EV, sig: `sig-${i}`, count: i + 1 })
    ).join("\n")
    const s = aggregateFeErrors(lines)
    expect(s.sigs).toBe(12)
    expect(s.top).toHaveLength(8)
    expect(s.top[0].count).toBe(12)
  })
})
