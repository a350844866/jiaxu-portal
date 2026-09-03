import { describe, expect, it } from "vitest"
import {
  parseQuotaFrame,
  fmtCountdown,
  fmtResetClock,
  parseIsoMs,
  sortLimits,
  limitLabel,
  limitUsd,
  isRolledOver,
  ageWithDrift,
  officialWeeklyStartMs,
  QUOTA_STALE_MS,
  QUOTA_FUTURE_SKEW_MS,
} from "@/lib/claude-quota-pure"

// 采样器真实一帧(2026-09-03 10:18 北京), 官方 resets_at 带 6 位微秒; limits 里有三条,
// weekly_scoped(scope=Fable) 48% 比全模型周池 33% 高 —— 这条才是 Fable "烧得快"的线
const NOW = Date.parse("2026-09-03T02:20:00Z")
const FRAME = {
  ts: "2026-09-03T02:18:20+00:00",
  ok: true,
  five_hour: { utilization: 46.0, resets_at: "2026-09-03T03:30:00.384478+00:00", window_start: "2026-09-02T22:30:00+00:00" },
  seven_day: { utilization: 32.0, resets_at: "2026-09-06T03:00:00.384497+00:00", window_start: "2026-08-30T03:00:00+00:00" },
  limits: [
    { kind: "session", group: "session", percent: 48, severity: "normal", resets_at: "2026-09-03T03:30:00.516444+00:00", scope: null, is_active: true },
    { kind: "weekly_all", group: "weekly", percent: 33, severity: "normal", resets_at: "2026-09-06T03:00:00.516472+00:00", scope: null, is_active: false },
    { kind: "weekly_scoped", group: "weekly", percent: 48, severity: "normal", resets_at: "2026-09-06T03:00:00.516725+00:00", scope: { model: { id: null, display_name: "Fable" }, surface: null }, is_active: false },
  ],
  usd_five_hour_by_model: { "claude-fable-5-1": { usd: 67.2, msgs: 175, out_tok: 420000 }, "claude-opus-5": { usd: 41.1 } },
  usd_seven_day_by_model: { "claude-opus-5": { usd: 764.2 }, "claude-fable-5-1": { usd: 220.0 }, "claude-fable-5": { usd: 128.5 }, "claude-sonnet-5": { usd: 38.9 } },
}

function okFrame(over: Record<string, unknown> = {}, now = NOW) {
  const q = parseQuotaFrame(JSON.stringify({ ...FRAME, ...over }), now)
  if (!q.ok) throw new Error(`expected ok, got ${q.error}`)
  return q
}

describe("parseIsoMs", () => {
  it("accepts 6-digit fractional seconds and +00:00 offsets", () => {
    expect(parseIsoMs("2026-09-03T03:30:00.019911+00:00")).toBe(Date.parse("2026-09-03T03:30:00.019Z"))
    expect(parseIsoMs("2026-09-03T02:08:20+00:00")).toBe(Date.parse("2026-09-03T02:08:20Z"))
    expect(parseIsoMs("garbage")).toBeNull()
    expect(parseIsoMs(null)).toBeNull()
  })
})

describe("parseQuotaFrame", () => {
  it("parses an ok frame: windows / limits / age / usd", () => {
    const q = okFrame()
    expect(q.sampled_at).toBe(FRAME.ts)
    expect(q.age_seconds).toBe(100)
    expect(q.stale).toBe(false)
    expect(q.db_error).toBeNull()
    expect(q.five_hour.utilization).toBe(46)
    expect(q.five_hour.usd_since_start).toBeCloseTo(108.3, 6)
    expect(q.seven_day.usd_since_start).toBeCloseTo(1151.6, 6)
    expect(q.limits.map((l) => [l.kind, l.percent, l.scope_model, l.is_active])).toEqual([
      ["session", 48, null, true],
      ["weekly_all", 33, null, false],
      ["weekly_scoped", 48, "Fable", false],
    ])
  })

  it("synthesizes session/weekly_all limits from the windows when the frame has no limits[] (old sampler)", () => {
    const q = okFrame({ limits: undefined })
    expect(q.limits.map((l) => [l.kind, l.percent, l.resets_at])).toEqual([
      ["session", 46, FRAME.five_hour.resets_at],
      ["weekly_all", 32, FRAME.seven_day.resets_at],
    ])
    // 坏条目(缺 kind)跳过, 剩余为空也回退合成
    expect(okFrame({ limits: [{ percent: 5 }] }).limits).toHaveLength(2)
  })

  it("usd: null when DB unavailable or nothing parseable; 0 when the window simply has no rows", () => {
    const q = okFrame({ usd_seven_day_by_model: null, db_error: "OperationalError: (2003)" })
    expect(q.seven_day.usd_since_start).toBeNull()
    expect(q.seven_day.usd_by_model).toEqual({})
    expect(q.db_error).toContain("2003")
    expect(okFrame({ usd_seven_day_by_model: {} }).seven_day.usd_since_start).toBe(0)
    expect(okFrame({ usd_seven_day_by_model: { a: { usd: "x" }, b: null } }).seven_day.usd_since_start).toBeNull()
    const mixed = okFrame({ usd_seven_day_by_model: { a: { usd: "x" }, b: { usd: 2 } } })
    expect(mixed.seven_day.usd_by_model).toEqual({ b: 2 })
    expect(mixed.seven_day.usd_since_start).toBe(2)
  })

  it("marks stale after 3 missed ticks", () => {
    const t0 = Date.parse("2026-09-03T02:18:20Z")
    expect(okFrame({}, t0 + QUOTA_STALE_MS + 1000).stale).toBe(true)
    expect(okFrame({}, t0 + QUOTA_STALE_MS - 1000).stale).toBe(false)
  })

  it("sampler failure (expired OAuth token) → ok:false carrying the sampler's error, never last frame's numbers", () => {
    const q = parseQuotaFrame(JSON.stringify({ ts: FRAME.ts, ok: false, error: "HTTPError: HTTP Error 401: Unauthorized" }), NOW)
    expect(q.ok).toBe(false)
    if (q.ok) return
    expect(q.error).toContain("401")
    expect(q.sampled_at).toBe(FRAME.ts)
    expect(q.age_seconds).toBe(100)
    expect(q.stale).toBe(true)
  })

  it("ok:true without both window utilizations is a corrupt frame, not an empty success", () => {
    const q = parseQuotaFrame(JSON.stringify({ ts: FRAME.ts, ok: true }), NOW)
    expect(q.ok).toBe(false)
    if (q.ok) return
    expect(q.error).toContain("utilization")
    expect(parseQuotaFrame(JSON.stringify({ ...FRAME, seven_day: { ...FRAME.seven_day, utilization: "41" } }), NOW).ok).toBe(false)
  })

  it("timestamps far in the future are rejected instead of being 'fresh forever'", () => {
    const q = parseQuotaFrame(JSON.stringify(FRAME), Date.parse(FRAME.ts) - QUOTA_FUTURE_SKEW_MS - 1000)
    expect(q.ok).toBe(false)
    if (q.ok) return
    expect(q.error).toContain("未来")
    // 小偏差(<5min)容忍, age 夹成 0
    expect(okFrame({}, Date.parse(FRAME.ts) - 60_000).age_seconds).toBe(0)
  })

  it("garbage / structurally empty → ok:false", () => {
    expect(parseQuotaFrame("{nope", NOW).ok).toBe(false)
    expect(parseQuotaFrame(JSON.stringify({ ok: true, ts: "not-a-date" }), NOW).ok).toBe(false)
    expect(parseQuotaFrame("null", NOW).ok).toBe(false)
  })

  it("clamps percent/utilization to 0-100", () => {
    const q = okFrame({ five_hour: { ...FRAME.five_hour, utilization: 130 }, limits: [{ kind: "session", percent: -3 }] })
    expect(q.five_hour.utilization).toBe(100)
    expect(q.limits[0].percent).toBe(0)
  })
})

describe("limits helpers", () => {
  const q = okFrame()
  it("sortLimits: session → scoped weekly → all-model weekly", () => {
    expect(sortLimits(q.limits).map((l) => l.kind)).toEqual(["session", "weekly_scoped", "weekly_all"])
  })
  it("limitLabel", () => {
    expect(q.limits.map(limitLabel)).toEqual(["5 小时窗", "本周 · 全模型", "本周 · Fable"])
    expect(limitLabel({ ...q.limits[2], scope_model: null })).toBe("本周 · 专属")
    expect(limitLabel({ ...q.limits[0], kind: "monthly_x" })).toBe("monthly_x")
  })
  it("limitUsd: scoped weekly sums only the scoped family; others take the whole window", () => {
    expect(limitUsd(q.limits[0], q).usd).toBeCloseTo(108.3, 6)
    expect(limitUsd(q.limits[1], q).usd).toBeCloseTo(1151.6, 6)
    const scoped = limitUsd(q.limits[2], q)
    expect(scoped.usd).toBeCloseTo(348.5, 6)
    expect(Object.keys(scoped.by_model).sort()).toEqual(["claude-fable-5", "claude-fable-5-1"])
    const noDb = okFrame({ usd_seven_day_by_model: null, db_error: "x" })
    expect(limitUsd(noDb.limits[2], noDb).usd).toBeNull()
  })
  it("isRolledOver / ageWithDrift / officialWeeklyStartMs", () => {
    expect(isRolledOver(FRAME.five_hour.resets_at, NOW)).toBe(false)
    expect(isRolledOver(FRAME.five_hour.resets_at, Date.parse("2026-09-03T03:31:00Z"))).toBe(true)
    expect(isRolledOver(null, NOW)).toBe(false)
    expect(ageWithDrift(100, NOW, NOW + 90_000)).toBe(190)
    expect(ageWithDrift(100, NOW, NOW - 5000)).toBe(95)
    expect(officialWeeklyStartMs(q, NOW)).toBe(Date.parse("2026-08-30T03:00:00.516Z"))
    // 没 limits 时用合成的 weekly_all(= seven_day.resets_at − 7d); 连 resets_at 也没有才退到
    // 采样器算的 window_start; 窗口起点不在 (now-8d, now] 内则拒绝
    expect(officialWeeklyStartMs(okFrame({ limits: undefined }), NOW)).toBe(Date.parse("2026-08-30T03:00:00.384Z"))
    expect(officialWeeklyStartMs(okFrame({ limits: undefined, seven_day: { utilization: 32, resets_at: null, window_start: "2026-08-30T03:00:00Z" } }), NOW)).toBe(Date.parse("2026-08-30T03:00:00Z"))
    expect(officialWeeklyStartMs(okFrame({ limits: undefined, seven_day: { utilization: 32, resets_at: null, window_start: "2026-01-01T00:00:00Z" } }), NOW)).toBeNull()
    expect(officialWeeklyStartMs(parseQuotaFrame("{nope", NOW), NOW)).toBeNull()
  })
})

describe("fmtCountdown", () => {
  it("formats d/h/m, sub-minute, past windows, and junk", () => {
    expect(fmtCountdown("2026-09-03T03:30:00.384478+00:00", NOW)).toBe("1h 10m")
    expect(fmtCountdown("2026-09-06T03:00:00Z", NOW)).toBe("3d 0h")
    expect(fmtCountdown("2026-09-03T02:55:30Z", NOW)).toBe("35m")
    expect(fmtCountdown("2026-09-03T02:20:30Z", NOW)).toBe("<1m")
    expect(fmtCountdown("2026-09-03T02:00:00Z", NOW)).toBe("已重置")
    expect(fmtCountdown(null, NOW)).toBe("—")
    expect(fmtCountdown("garbage", NOW)).toBe("—")
  })
})

describe("fmtResetClock", () => {
  it("renders the Beijing wall clock (UTC+8), optionally with weekday", () => {
    expect(fmtResetClock("2026-09-03T03:30:00.019911+00:00")).toBe("11:30")
    expect(fmtResetClock("2026-09-06T03:00:00Z", true)).toMatch(/周日.*11:00/)
    expect(fmtResetClock("2026-09-03T16:00:00Z")).toBe("00:00")
    expect(fmtResetClock(null)).toBe("")
  })
})
