import { describe, expect, test } from "vitest"
import { foldUnknownHomeRows, type SystemSummary } from "../usage-db"

// foldUnknownHomeRows 保证 home 侧分区完备：ALL_SYSTEMS 白名单外的 system_name
// 折进 other 桶而不是从 totals 蒸发（2026-08-06 worker-pool-other 事故的回归护栏）。
// mysql RowDataPacket 在运行时就是普通对象，测试里按结构造。

function row(fields: Record<string, unknown>) {
  return {
    today_input: 0,
    today_output: 0,
    today_cache_read: 0,
    today_cache_create: 0,
    today_cost_usd: 0,
    month_cost_usd: 0,
    month_total_tokens: 0,
    last1h_cost_usd: 0,
    last1h_total_tokens: 0,
    last_event_ts: null,
    ...fields,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function bucket(system: SystemSummary["system"], fields: Partial<SystemSummary> = {}): SystemSummary {
  return {
    system,
    today_input: 0,
    today_output: 0,
    today_cache_read: 0,
    today_cache_create: 0,
    today_cost_usd: 0,
    today_total_tokens: 0,
    month_cost_usd: 0,
    month_total_tokens: 0,
    last1h_cost_usd: 0,
    last1h_total_tokens: 0,
    last_event_ts: null,
    ...fields,
  }
}

describe("foldUnknownHomeRows", () => {
  test("白名单内的 system_name 不折（它们已由 ALL_SYSTEMS.map 各自成桶）", () => {
    const systems = [bucket("interactive", { today_cost_usd: 100 }), bucket("other")]
    foldUnknownHomeRows(systems, [
      row({ system_name: "interactive", today_cost_usd: 100 }),
      row({ system_name: "pm-paper", today_cost_usd: 14 }),
      row({ system_name: "worker-pool-other", today_cost_usd: 28 }),
    ])
    expect(systems.find((s) => s.system === "other")!.today_cost_usd).toBe(0)
    expect(systems.find((s) => s.system === "interactive")!.today_cost_usd).toBe(100)
  })

  test("白名单外的 system_name 折进 other，恰好计一次，token 分量重算", () => {
    const systems = [bucket("other")]
    foldUnknownHomeRows(systems, [
      row({
        system_name: "some-future-bucket",
        today_cost_usd: 28.5,
        today_input: 1,
        today_output: 2,
        today_cache_read: 3,
        today_cache_create: 4,
        month_cost_usd: 244,
        month_total_tokens: 5000,
        last1h_total_tokens: 77,
      }),
    ])
    const other = systems.find((s) => s.system === "other")!
    expect(other.today_cost_usd).toBe(28.5)
    expect(other.today_total_tokens).toBe(10)
    expect(other.month_cost_usd).toBe(244)
    expect(other.month_total_tokens).toBe(5000)
    expect(other.last1h_total_tokens).toBe(77)
    expect(systems.filter((s) => s.system === "other")).toHaveLength(1)
  })

  test("other 桶自身已有值时叠加而非覆盖", () => {
    const systems = [
      bucket("other", { today_cost_usd: 5, today_input: 10, today_total_tokens: 10, month_cost_usd: 50 }),
    ]
    foldUnknownHomeRows(systems, [
      row({ system_name: "unknown-a", today_cost_usd: 3, today_input: 20, month_cost_usd: 30 }),
      row({ system_name: "unknown-b", today_cost_usd: 2, today_input: 5, month_cost_usd: 20 }),
    ])
    const other = systems[0]
    expect(other.today_cost_usd).toBe(10)
    expect(other.today_input).toBe(35)
    expect(other.today_total_tokens).toBe(35)
    expect(other.month_cost_usd).toBe(100)
  })

  test("systems 里没有 other 桶时创建一个，而不是抛错", () => {
    const systems = [bucket("interactive")]
    expect(() =>
      foldUnknownHomeRows(systems, [row({ system_name: "unknown", today_cost_usd: 7 })]),
    ).not.toThrow()
    expect(systems.find((s) => s.system === "other")?.today_cost_usd).toBe(7)
  })

  test("last_event_ts 取被折行里的最大值", () => {
    const systems = [bucket("other")]
    foldUnknownHomeRows(systems, [
      row({ system_name: "unknown-a", last_event_ts: "2026-08-06T01:00:00.000Z" }),
      row({ system_name: "unknown-b", last_event_ts: "2026-08-06T06:00:00.000Z" }),
      row({ system_name: "unknown-c", last_event_ts: "2026-08-05T23:00:00.000Z" }),
    ])
    expect(systems[0].last_event_ts).toBe("2026-08-06T06:00:00.000Z")
  })

  test("没有未知行时不动 other 桶的 today_total_tokens（避免误覆盖 map 算好的值）", () => {
    const systems = [bucket("other", { today_input: 9, today_total_tokens: 9 })]
    foldUnknownHomeRows(systems, [row({ system_name: "interactive", today_cost_usd: 1 })])
    expect(systems[0].today_total_tokens).toBe(9)
    expect(systems[0].today_cost_usd).toBe(0)
  })
})
