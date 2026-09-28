import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { readEventLane } from "../pm-paper-event-reader"

let stateDir: string

beforeEach(() => {
  stateDir = mkdtempSync(path.join(tmpdir(), "pm-ev-"))
  process.env.PM_PAPER_STATE_DIR = stateDir
})

afterEach(() => {
  delete process.env.PM_PAPER_STATE_DIR
  rmSync(stateDir, { recursive: true, force: true })
})

describe("readEventLane", () => {
  it("event 目录不存在 → present=false(车道未部署,面板隐藏)", async () => {
    const view = await readEventLane()
    expect(view.present).toBe(false)
  })

  it("空车道(只有 cursor,未触发) → present=true、零漏斗、caps 0", async () => {
    mkdirSync(path.join(stateDir, "event"), { recursive: true })
    writeFileSync(path.join(stateDir, "event", "cursor.json"), JSON.stringify({ last_event_id: 1 }))
    const view = await readEventLane()
    expect(view.present).toBe(true)
    expect(view.watcherStale).toBe(false) // 刚写入,mtime 新鲜
    expect(view.funnelTotal).toEqual({})
    expect(view.capsToday).toMatchObject({ triage: 0, predict: 0 })
    expect(view.positions).toEqual([])
  })

  it("STOPPED.json 存在 → 心跳过期也不算 stale,带出停止时间与判定", async () => {
    const ev = path.join(stateDir, "event")
    mkdirSync(ev, { recursive: true })
    const cursor = path.join(ev, "cursor.json")
    writeFileSync(cursor, JSON.stringify({ last_event_id: 1 }))
    const old = Date.now() / 1000 - 3 * 86400
    utimesSync(cursor, old, old)
    writeFileSync(path.join(ev, "STOPPED.json"), JSON.stringify({ stopped_at: 1790582579, verdict: "uncertain" }))
    const view = await readEventLane()
    expect(view.stopped).toEqual({ at: 1790582579, verdict: "uncertain" })
    expect(view.watcherStale).toBe(false)
    expect(view.watcherAgeSeconds).toBeGreaterThan(2 * 86400)
  })

  it("没有 STOPPED.json 且心跳过期 → stale;STOPPED.json 坏 JSON 同样按 stale 报", async () => {
    const ev = path.join(stateDir, "event")
    mkdirSync(ev, { recursive: true })
    const cursor = path.join(ev, "cursor.json")
    writeFileSync(cursor, JSON.stringify({ last_event_id: 1 }))
    const old = Date.now() / 1000 - 3600
    utimesSync(cursor, old, old)
    let view = await readEventLane()
    expect(view.stopped).toBeNull()
    expect(view.watcherStale).toBe(true)
    writeFileSync(path.join(ev, "STOPPED.json"), "{not json")
    view = await readEventLane()
    expect(view.stopped).toBeNull()
    expect(view.watcherStale).toBe(true)
  })

  it("STOPPED.json 字段缺失/类型不对 → 仍算已停止,字段为 null", async () => {
    const ev = path.join(stateDir, "event")
    mkdirSync(ev, { recursive: true })
    writeFileSync(path.join(ev, "STOPPED.json"), JSON.stringify({ stopped_at: "yesterday" }))
    const view = await readEventLane()
    expect(view.stopped).toEqual({ at: null, verdict: null })
    expect(view.watcherStale).toBe(false)
  })

  it("STOPPED.json 是数组 → 不算已停止,按心跳判 stale", async () => {
    const ev = path.join(stateDir, "event")
    mkdirSync(ev, { recursive: true })
    writeFileSync(path.join(ev, "STOPPED.json"), JSON.stringify([{ stopped_at: 1 }]))
    const view = await readEventLane()
    expect(view.stopped).toBeNull()
    expect(view.watcherStale).toBe(true) // 无 cursor.json
  })

  it("已停止时 probeStale 看 summary.json 新鲜度:新鲜 → false,过期/缺失 → true", async () => {
    const ev = path.join(stateDir, "event")
    mkdirSync(ev, { recursive: true })
    writeFileSync(path.join(ev, "STOPPED.json"), JSON.stringify({ stopped_at: 1790582579, verdict: "uncertain" }))
    let view = await readEventLane()
    expect(view.probeStale).toBe(true) // summary.json 缺失
    const summary = path.join(ev, "summary.json")
    writeFileSync(summary, JSON.stringify({ updated: 1 }))
    view = await readEventLane()
    expect(view.probeStale).toBe(false)
    const old = Date.now() / 1000 - 4 * 3600
    utimesSync(summary, old, old)
    view = await readEventLane()
    expect(view.probeStale).toBe(true)
  })

  it("STOPPED.json 时间戳越界/非有限 → at=null 但仍算已停止", async () => {
    const ev = path.join(stateDir, "event")
    mkdirSync(ev, { recursive: true })
    const marker = path.join(ev, "STOPPED.json")
    for (const raw of ['{"stopped_at": 1e20}', '{"stopped_at": 1e999}', '{"stopped_at": -5}']) {
      writeFileSync(marker, raw)
      const view = await readEventLane()
      expect(view.stopped).toEqual({ at: null, verdict: null })
    }
  })

  it("已停止且影子仓全部结算 → probeDone,summary 过期也不报 stale", async () => {
    const ev = path.join(stateDir, "event")
    mkdirSync(ev, { recursive: true })
    writeFileSync(path.join(ev, "STOPPED.json"), JSON.stringify({ stopped_at: 1790582579, verdict: "uncertain" }))
    const summary = path.join(ev, "summary.json")
    writeFileSync(summary, JSON.stringify({ settled: { n: 2, taker0_pnl_sum: 1 } }))
    const old = Date.now() / 1000 - 10 * 3600
    utimesSync(summary, old, old)
    const shadow = (secondSettled: boolean) =>
      writeFileSync(
        path.join(ev, "shadow_state.json"),
        JSON.stringify({
          positions: {
            a: { prediction_id: "a", market_id: "m1", settled: { won: true } },
            b: { prediction_id: "b", market_id: "m2", settled: secondSettled ? { won: false } : null },
          },
        }),
      )
    shadow(true)
    let view = await readEventLane()
    expect(view.probeDone).toBe(true)
    expect(view.probeStale).toBe(false)
    shadow(false) // summary 计数说全结算也不信,以 shadow_state 为准
    view = await readEventLane()
    expect(view.probeDone).toBe(false)
    expect(view.probeStale).toBe(true)
  })

  it("完整状态 → 漏斗计数/仓位映射/配对差/MTM 计算正确,坏尾行不炸", async () => {
    const ev = path.join(stateDir, "event")
    mkdirSync(ev, { recursive: true })
    const now = Math.floor(Date.now() / 1000)
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" })
    writeFileSync(path.join(ev, "cursor.json"), JSON.stringify({ last_event_id: 9 }))
    writeFileSync(path.join(ev, "caps.json"), JSON.stringify({ [today]: { triage: 3 } }))
    writeFileSync(path.join(ev, "pcaps.json"), JSON.stringify({ [today]: 2 }))
    writeFileSync(
      path.join(ev, "candidates.jsonl"),
      [
        JSON.stringify({ ts: now, stage: "triage_queued", market_id: "m1" }),
        JSON.stringify({ ts: now, stage: "shadow_opened", market_id: "m1" }),
        JSON.stringify({ ts: now - 200000, stage: "weak_match", market_id: "m2" }),
        '{"torn": ', // writer 正在 append 的半行
      ].join("\n"),
    )
    writeFileSync(
      path.join(ev, "event_predictions.jsonl"),
      JSON.stringify({ prediction_id: "m1-r1", market_id: "m1" }) + "\n",
    )
    writeFileSync(
      path.join(ev, "shadow_state.json"),
      JSON.stringify({
        positions: {
          "m1-r1": {
            prediction_id: "m1-r1",
            market_id: "m1",
            side: "YES",
            p: 0.62,
            t0: now - 7 * 3600,
            latency_ok: true,
            snap0: { mid: 0.5 },
            legs: {
              taker0: { status: "filled", fill_px: 0.52, shares: 192.3077 },
              maker0: { status: "expired" },
              taker30: { status: "filled", fill_px: 0.55, shares: 181.8182 },
              taker180: { status: "missed" },
            },
            marks: { mtm6h: { ts: now - 3600, side_mid: 0.6 }, mtm24h: null },
            settled: null,
          },
        },
      }),
    )
    writeFileSync(
      path.join(ev, "summary.json"),
      JSON.stringify({
        updated: now,
        paired: { all: { mtm6h_taker0_minus_taker180: { n: 4, mean: 1.25, ci95_cluster: [0.1, 2.4] } } },
        settled: { n: 1, taker0_pnl_sum: 3.5 },
      }),
    )
    writeFileSync(
      path.join(stateDir, "universe.json"),
      JSON.stringify({ markets: [{ id: "m1", question: "Will X happen?" }] }),
    )

    const view = await readEventLane()
    expect(view.present).toBe(true)
    expect(view.capsToday).toMatchObject({ triage: 3, predict: 2 })
    expect(view.funnelTotal).toEqual({ triage_queued: 1, shadow_opened: 1, weak_match: 1 })
    expect(view.funnelToday.weak_match).toBeUndefined() // 昨天的弱命中不计今日
    expect(view.predictionsCount).toBe(1)
    expect(view.positions).toHaveLength(1)
    const pos = view.positions[0]
    expect(pos.marketQuestion).toBe("Will X happen?")
    expect(pos.legs.taker0.status).toBe("filled")
    // MTM = shares*mid - 100 = 192.3077*0.6-100 = 15.38
    expect(pos.mtm6h).toBeCloseTo(15.38, 1)
    expect(pos.mtm24h).toBeNull()
    expect(view.paired.all["mtm6h_taker0_minus_taker180"]).toEqual({ n: 4, mean: 1.25, ci95: [0.1, 2.4] })
    expect(view.settled).toEqual({ n: 1, taker0PnlSum: 3.5 })
  })
})
