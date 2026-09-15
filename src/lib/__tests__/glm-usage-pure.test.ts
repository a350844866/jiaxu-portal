import { describe, expect, it } from "vitest"
import {
  GLM_STALE_MS,
  GLM_FUTURE_SKEW_MS,
  ageLabel,
  beijingDate,
  fmtTokens,
  hostSyncLabel,
  parseGlmSnapshot,
  quotaText,
  readErrorResult,
  sortBuckets,
  type GlmHost,
} from "@/lib/glm-usage-pure"

// 北京 2026-09-15 15:00
const NOW = Date.parse("2026-09-15T07:00:00Z")

const bucket = (total: number, msgs = 1) => ({ input: 0, cache_read: total, cache_creation: 0, output: 0, total, msgs })

const SNAP = {
  schema: 1,
  kind: "glm-usage",
  generated_at: "2026-09-15T06:57:00Z",
  tz: "Asia/Shanghai",
  month: "2026-09",
  today: "2026-09-15",
  hosts: [
    { host: "mbp", label: "MBP（公司）", ok: true, error: null, source_generated_at: "2026-09-15T06:50:00Z", age_seconds: 420, stale: false, unique_msgs: 1044, counted_msgs: 1044 },
    { host: "yunmai-vm", label: "家服云脉 VM", ok: false, error: "未收到该机帧（同步未安装或从未成功）", source_generated_at: null, age_seconds: null, stale: true, unique_msgs: null, counted_msgs: 0 },
  ],
  dedup: { raw_usage_lines: 2306, counted_msgs: 1044, cross_host_dups: 0, undated_msgs: 0 },
  windows: {
    month: { totals: bucket(300, 3), by_model: { "glm-5.2": bucket(100), "glm-5.3": bucket(200, 2) }, by_host: { mbp: bucket(300, 3) }, by_project: {}, projects_omitted: 0 },
    today: { totals: bucket(50), by_model: {}, by_host: {}, by_project: {}, projects_omitted: 0 },
  },
  all_time: { totals: bucket(300, 3) },
  quota: { status: "unavailable", probed_at: "2026-09-15", detail: "404/401" },
}

const parse = (over: Record<string, unknown> = {}, now = NOW) => parseGlmSnapshot(JSON.stringify({ ...SNAP, ...over }), now)

describe("parseGlmSnapshot", () => {
  it("正常快照: 数字、host、额度段原样带出", () => {
    const r = parse()
    if (!r.ok) throw new Error(r.error)
    expect(r.ageSeconds).toBe(180)
    expect(r.stale).toBe(false)
    expect(r.dayRolled).toBe(false)
    expect(r.data.windows.month.totals.total).toBe(300)
    expect(r.data.hosts.map((h) => h.host)).toEqual(["mbp", "yunmai-vm"])
    expect(r.data.dedup.raw_usage_lines).toBe(2306)
    expect(r.data.quota?.status).toBe("unavailable")
  })

  it("陈旧: 超 15min 仍渲染数据但标 stale", () => {
    const r = parse({}, Date.parse("2026-09-15T06:57:00Z") + GLM_STALE_MS + 1000)
    expect(r.ok && r.stale).toBe(true)
  })

  it("刚好 15min 不算陈旧", () => {
    const r = parse({}, Date.parse("2026-09-15T06:57:00Z") + GLM_STALE_MS)
    expect(r.ok && r.stale).toBe(false)
  })

  it("跨北京午夜: 快照的今日已不是今天 → dayRolled(不跨月)", () => {
    const r = parse({ generated_at: "2026-09-15T15:58:00Z" }, Date.parse("2026-09-15T16:01:00Z"))
    expect(r.ok && r.dayRolled).toBe(true)
    expect(r.ok && r.monthRolled).toBe(false)
  })

  it("跨北京月初 → dayRolled + monthRolled", () => {
    const r = parse({ generated_at: "2026-09-30T15:58:00Z", month: "2026-09", today: "2026-09-30" }, Date.parse("2026-09-30T16:02:00Z"))
    expect(r.ok && r.dayRolled && r.monthRolled).toBe(true)
  })

  it("解析失败 → invalid", () => {
    const r = parseGlmSnapshot("{oops", NOW)
    expect(r).toMatchObject({ ok: false, kind: "invalid", stale: true })
    expect(!r.ok && r.error).toContain("JSON")
  })

  it("schema 版本不符 → invalid, 不硬解新格式, 报错不回显快照值", () => {
    const r = parse({ schema: "PRIVATE-TEXT-" + "x".repeat(1000), kind: "PRIVATE-KIND" })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain("schema")
    expect(!r.ok && r.error).not.toContain("PRIVATE")
    expect(parse({ schema: 2 }).ok).toBe(false)
  })

  it("缺 generated_at / 缺窗口 → invalid", () => {
    expect(parse({ generated_at: undefined }).ok).toBe(false)
    expect(parse({ windows: { month: SNAP.windows.month } }).ok).toBe(false)
  })

  it("时间在未来(超出允许偏差) → invalid; 偏差内夹成 0", () => {
    const gen = Date.parse(SNAP.generated_at)
    expect(parse({}, gen - GLM_FUTURE_SKEW_MS - 1000).ok).toBe(false)
    const r = parse({}, gen - 60_000)
    expect(r.ok && r.ageSeconds).toBe(0)
  })

  it("脏数值被清洗为 0, 不让 NaN/负数进 UI", () => {
    const r = parse({
      windows: {
        month: { totals: { input: -5, cache_read: "x", cache_creation: null, output: 3, total: 3, msgs: 1 }, by_model: null },
        today: { totals: {} },
      },
    })
    if (!r.ok) throw new Error(r.error)
    expect(r.data.windows.month.totals).toEqual({ input: 0, cache_read: 0, cache_creation: 0, output: 3, total: 3, msgs: 1 })
    expect(r.data.windows.month.by_model).toEqual({})
  })

  it("快照没带额度段 → quota=null(与网关无接口区分)", () => {
    const r = parse({ quota: undefined })
    expect(r.ok && r.data.quota).toBeNull()
  })
})

describe("readErrorResult(缺帧/超时/过大分别降级)", () => {
  it("ENOENT → missing, 提示 timer", () => {
    const r = readErrorResult("ENOENT")
    expect(r.kind).toBe("missing")
    expect(r.error).toContain("glm-usage-snapshot.timer")
  })
  it("超时 → io", () => {
    expect(readErrorResult("AbortError")).toMatchObject({ kind: "io" })
    expect(readErrorResult("TimeoutError").error).toContain("超时")
  })
  it("过大 / 其它错误码 → io, 只透出错误码", () => {
    expect(readErrorResult("TOO_LARGE").error).toContain("过大")
    expect(readErrorResult("EACCES").error).toBe("读快照失败(EACCES)")
  })
})

describe("quotaText(额度文案)", () => {
  it("网关无接口 → 如实写, 不出现任何数字", () => {
    const t = quotaText({ status: "unavailable", probed_at: "2026-09-15", detail: null })
    expect(t).toBe("额度：网关未提供接口")
    expect(t).not.toMatch(/\d/)
  })
  it("缺额度段 / 未知状态 → 状态未知", () => {
    expect(quotaText(null)).toContain("状态未知")
    expect(quotaText({ status: "weird", probed_at: null, detail: null })).toBe("额度：状态未知（weird）")
  })
})

describe("格式与分桶辅助", () => {
  it("fmtTokens 与 MBP 对账量级一致", () => {
    expect(fmtTokens(78_370_000)).toBe("78.37M")
    expect(fmtTokens(1_510_000)).toBe("1.51M")
    expect(fmtTokens(999)).toBe("999")
  })
  it("sortBuckets 按合计降序", () => {
    const r = parse()
    if (!r.ok) throw new Error(r.error)
    expect(sortBuckets(r.data.windows.month.by_model).map(([k]) => k)).toEqual(["glm-5.3", "glm-5.2"])
  })
  it("hostSyncLabel: 帧坏 / 未同步 / 正常", () => {
    const base: GlmHost = { host: "mbp", label: "MBP", ok: true, error: null, source_generated_at: null, age_seconds: 300, stale: false, unique_msgs: 1, counted_msgs: 1 }
    expect(hostSyncLabel(base)).toEqual({ text: "同步于 5 分钟前", warn: false })
    expect(hostSyncLabel({ ...base, stale: true, age_seconds: 7200 })).toEqual({ text: "未同步 2.0 小时前", warn: true })
    expect(hostSyncLabel({ ...base, ok: false, error: "帧不是合法 JSON" })).toEqual({ text: "帧不是合法 JSON", warn: true })
    // 帧健康但家服账本损坏重建过: 仍要告警
    expect(hostSyncLabel({ ...base, error: "家服账本损坏，已另存 .corrupt 并重建" })).toEqual({ text: "家服账本损坏，已另存 .corrupt 并重建", warn: true })
  })
  it("beijingDate / ageLabel", () => {
    expect(beijingDate(Date.parse("2026-08-31T16:30:00Z"))).toBe("2026-09-01")
    expect(ageLabel(null)).toBe("无数据")
    expect(ageLabel(30)).toBe("刚刚")
  })
})
