import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { readPmScalpSnapshot } from "../pm-scalp-reader"

describe("readPmScalpSnapshot", () => {
  let dir: string
  const origEnv = process.env.PM_SCALP_DIR

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "pm-scalp-test-"))
    process.env.PM_SCALP_DIR = dir
    await fs.mkdir(path.join(dir, "paper"), { recursive: true })
    await fs.mkdir(path.join(dir, "data"), { recursive: true })
  })

  afterAll(async () => {
    if (origEnv === undefined) delete process.env.PM_SCALP_DIR
    else process.env.PM_SCALP_DIR = origEnv
  })

  const entry = (w: number, v: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      type: "entry", w, v, mode: "taker", side_up: false, px: 0.45,
      sh: 222.22, fee: 3.85, s: 190, disp: 1.98, strike: 64225.3, ref: "cl",
      ...extra,
    })
  const settle = (w: number, v: string, won: boolean, pnl: number) =>
    JSON.stringify({ type: "settle", w, v, won, pnl, outcomeUp: won ? 0.0 : 1.0, src: "gamma" })

  it("空态: 全部文件缺失 → 不抛错, 零交易, null 新鲜度", async () => {
    const snap = await readPmScalpSnapshot()
    expect(snap.ok).toBe(true)
    expect(snap.totals).toEqual({ settled: 0, wins: 0, pnl: 0, open: 0, settledCost: 0, roiOnCost: null })
    expect(snap.dataAgeSeconds).toBeNull()
    expect(snap.heartbeatAgeSeconds).toBeNull()
    expect(snap.windowsRecorded).toBe(0)
    expect(snap.basis).toBeNull()
    expect(snap.variants).toHaveLength(6) // 六变体骨架始终存在
    expect(snap.openEntries).toEqual([])
    expect(snap.recentTrades).toEqual([])
  })

  it("entry/settle join: 已结算与持仓分流, 变体统计正确", async () => {
    await fs.writeFile(
      path.join(dir, "paper", "trades.jsonl"),
      [
        entry(1783671600, "N1"),
        settle(1783671600, "N1", false, -103.85),
        entry(1783671900, "N1"), // 未结算 → open
        entry(1783671900, "P1", { px: 0.003, sh: 3333.33, fee: 0.7 }),
        settle(1783671900, "P1", true, 9.3),
        "",
      ].join("\n"),
    )
    const snap = await readPmScalpSnapshot()
    const n1 = snap.variants.find((v) => v.id === "N1")!
    expect(n1.settled).toBe(1)
    expect(n1.wins).toBe(0)
    expect(n1.pnl).toBeCloseTo(-103.85)
    expect(n1.winrate).toBe(0)
    expect(n1.open).toBe(1)
    const p1 = snap.variants.find((v) => v.id === "P1")!
    expect(p1.settled).toBe(1)
    expect(p1.wins).toBe(1)
    expect(p1.winrate).toBe(1)
    // 盈利率 = pnl / 已结算投入(买入成本+费): N1 settledCost=0.45*222.22+3.85≈103.85
    expect(n1.settledCost).toBeCloseTo(103.85, 1)
    expect(n1.roiOnCost).toBeCloseTo(-1.0, 2)
    expect(snap.totals.settledCost).toBeCloseTo(103.85 + 0.003 * 3333.33 + 0.7, 1)
    expect(snap.totals.roiOnCost).toBeCloseTo(-94.55 / 114.55, 2)
    expect(snap.totals).toMatchObject({ settled: 2, wins: 1, pnl: expect.closeTo(-94.55, 2), open: 1 })
    expect(snap.openEntries).toHaveLength(1)
    expect(snap.recentTrades).toHaveLength(2)
    // 最近结算按窗口倒序
    expect(snap.recentTrades[0].w).toBe(1783671900)
    // windowLabel 带日期 + 24h(交易稀疏可能跨天)
    expect(snap.recentTrades[0].windowLabel).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/)
  })

  it("重复 (w,v) entry 只计一次;孤儿 settle 与坏行被忽略", async () => {
    await fs.writeFile(
      path.join(dir, "paper", "trades.jsonl"),
      [
        entry(1783671600, "N1"),
        entry(1783671600, "N1"), // papertrader 崩溃重启理论上的重入
        settle(1783671600, "N1", true, 122.15),
        settle(1783672200, "N3", false, -50), // 孤儿 settle(无对应 entry)
        "{not json",
        "",
      ].join("\n"),
    )
    const snap = await readPmScalpSnapshot()
    const n1 = snap.variants.find((v) => v.id === "N1")!
    expect(n1.settled).toBe(1)
    expect(n1.pnl).toBeCloseTo(122.15)
    const n3 = snap.variants.find((v) => v.id === "N3")!
    expect(n3.settled).toBe(0) // 孤儿 settle 不计入
    expect(snap.totals.settled).toBe(1)
  })

  it("最新窗口行 → dataAgeSeconds 与 cl-bn 基差;heartbeat → 心跳年龄", async () => {
    const now = Date.now()
    const wts = Math.floor(now / 1000 / 300) * 300
    await fs.writeFile(
      path.join(dir, "data", `window-${wts}.jsonl`),
      [
        JSON.stringify({ meta: 1, ts: wts, up: "1", down: "2", title: "t" }),
        JSON.stringify({ t: now - 3000, s: 10, btc_b: 64312.42, btc_a: 64312.43, cl: 64265.45, ub: 0.5, ua: 0.51, db: 0.49, da: 0.5 }),
        "",
      ].join("\n"),
    )
    await fs.writeFile(path.join(dir, "paper", "heartbeat"), String(Math.floor(now / 1000) - 9))
    const snap = await readPmScalpSnapshot()
    expect(snap.windowsRecorded).toBe(1)
    expect(snap.dataAgeSeconds).toBeGreaterThanOrEqual(2)
    expect(snap.dataAgeSeconds).toBeLessThanOrEqual(5)
    expect(snap.heartbeatAgeSeconds).toBeGreaterThanOrEqual(8)
    expect(snap.heartbeatAgeSeconds).toBeLessThanOrEqual(11)
    expect(snap.basis).not.toBeNull()
    expect(snap.basis!.usd).toBeCloseTo(64312.425 - 64265.45, 1)
    expect(snap.basis!.bps).toBeGreaterThan(6)
  })

  it("窗口行缺 cl 或缺币安 → 基差为 null 但新鲜度仍可用", async () => {
    const now = Date.now()
    const wts = Math.floor(now / 1000 / 300) * 300
    await fs.writeFile(
      path.join(dir, "data", `window-${wts}.jsonl`),
      JSON.stringify({ t: now - 1000, s: 5, ub: 0.5, ua: 0.51, db: 0.49, da: 0.5 }) + "\n",
    )
    const snap = await readPmScalpSnapshot()
    expect(snap.basis).toBeNull()
    expect(snap.dataAgeSeconds).not.toBeNull()
  })
})
