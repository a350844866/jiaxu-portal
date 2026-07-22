import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
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
