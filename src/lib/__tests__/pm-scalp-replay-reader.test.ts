import { describe, it, expect } from "vitest"
import { parseReplayFile } from "../pm-scalp-replay-reader"

const goodTrade = {
  w: 1783894200, s: 289, disp: 2.16, side: "Down", eff: 0.94, limit: 0.95,
  post_ms: 871, matched: 5.0, won: true, px: 0.95, pnl: 0.25, strike: 63689.17,
  series: Array.from({ length: 300 }, (_, i) => [i, -2 + i * 0.001, 0.9, 0.95]),
}

describe("parseReplayFile", () => {
  it("解析合法文件并按窗口时间排序", () => {
    const snap = parseReplayFile(JSON.stringify({
      meta: { generated: "2026-07-14" },
      trades: [{ ...goodTrade, w: 1783905900 }, goodTrade],
    }))
    expect(snap.trades).toHaveLength(2)
    expect(snap.trades[0].w).toBe(1783894200)
    expect(snap.trades[0].windowLabel).toBe("07-13 06:10")
    expect(snap.trades[0].won).toBe(true)
    expect(snap.trades[0].series[0]).toEqual({ s: 0, disp: -2, bid: 0.9, ask: 0.95 })
    expect(snap.generated).toBe("2026-07-14")
  })

  it("畸形笔与畸形行被丢弃,不产生 NaN", () => {
    const snap = parseReplayFile(JSON.stringify({
      trades: [
        { ...goodTrade, px: "oops" },                       // 整笔丢弃
        { ...goodTrade, series: [[0, null], ...goodTrade.series] }, // 畸形行丢弃
      ],
    }))
    expect(snap.trades).toHaveLength(1)
    expect(snap.trades[0].series).toHaveLength(300)
    for (const p of snap.trades[0].series) {
      expect(Number.isFinite(p.disp)).toBe(true)
    }
  })

  it("轨迹残缺(<30 行)整笔不展示", () => {
    const snap = parseReplayFile(JSON.stringify({
      trades: [{ ...goodTrade, series: goodTrade.series.slice(0, 10) }],
    }))
    expect(snap.trades).toHaveLength(0)
  })

  it("非 JSON / 空文件返回空快照而非抛错", () => {
    expect(parseReplayFile("not json").trades).toHaveLength(0)
    expect(parseReplayFile("{}").trades).toHaveLength(0)
  })

  it("合法 JSON 但形状畸形也绝不抛错(展示层隔离)", () => {
    expect(parseReplayFile("null").trades).toHaveLength(0)
    expect(parseReplayFile("42").trades).toHaveLength(0)
    expect(parseReplayFile('{"trades": 42}').trades).toHaveLength(0)
    expect(parseReplayFile('{"trades": {}}').trades).toHaveLength(0)
    expect(parseReplayFile('{"trades": [null]}').trades).toHaveLength(0)
    expect(parseReplayFile('{"trades": ["x"]}').trades).toHaveLength(0)
    expect(parseReplayFile('{"meta": 7, "trades": []}').generated).toBe("")
  })

  it("bid/ask 缺省行与 post_ms 缺省解析为 null", () => {
    const snap = parseReplayFile(JSON.stringify({
      trades: [{ ...goodTrade, post_ms: undefined,
                 series: Array.from({ length: 40 }, (_, i) => [i, 1.0]) }],
    }))
    expect(snap.trades).toHaveLength(1)
    expect(snap.trades[0].postMs).toBeNull()
    expect(snap.trades[0].series[0]).toEqual({ s: 0, disp: 1.0, bid: null, ask: null })
  })
})
