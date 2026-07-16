import { describe, it, expect } from "vitest"
import { parseReplayFile } from "../pm-scalp-replay-reader"

// tick-v1: series=[s,bid,ask] 买入侧份额价（0..1），prints=[s,price]
const goodTrade = {
  w: 1783894200,
  strategy: "VN1",
  side: "Down",
  sEntry: 289,
  limit: 0.95,
  matched: 5.0,
  pnl: 0.25,
  won: true,
  filled: true,
  postMs: 871,
  q: 0.99,
  sigRem: 6.4,
  effSeen: 0.94,
  outcomeUp: 0.0,
  series: Array.from({ length: 300 }, (_, i) => [i, 0.9 + i * 0.0001, 0.92 + i * 0.0001]),
  prints: Array.from({ length: 20 }, (_, i) => [280 + i * 0.1, 0.93]),
}

describe("parseReplayFile (tick-v1)", () => {
  it("解析合法文件并按窗口时间倒序(最新在前)", () => {
    const snap = parseReplayFile(JSON.stringify({
      meta: { generated_ts: 1784163714 },
      trades: [{ ...goodTrade, w: 1783894200 }, { ...goodTrade, w: 1783905900 }],
    }))
    expect(snap.trades).toHaveLength(2)
    expect(snap.trades[0].w).toBe(1783905900) // 最新在前
    expect(snap.trades[1].windowLabel).toBe("07-13 06:10")
    expect(snap.trades[1].won).toBe(true)
    expect(snap.trades[1].strategy).toBe("VN1")
    expect(snap.trades[1].series[0]).toEqual({ s: 0, bid: 0.9, ask: 0.92 })
    expect(snap.trades[1].prints[0]).toEqual({ s: 280, price: 0.93 })
    expect(snap.generated).not.toBe("") // generated_ts → 格式化字符串
  })

  it("畸形笔与畸形行被丢弃,不产生 NaN", () => {
    const snap = parseReplayFile(JSON.stringify({
      trades: [
        { ...goodTrade, limit: "oops" },                          // 整笔丢弃
        { ...goodTrade, series: [[0, null, 0.5], ...goodTrade.series] }, // 畸形行丢弃
      ],
    }))
    expect(snap.trades).toHaveLength(1)
    expect(snap.trades[0].series).toHaveLength(300)
    for (const p of snap.trades[0].series) {
      expect(Number.isFinite(p.bid) && Number.isFinite(p.ask)).toBe(true)
    }
  })

  it("轨迹残缺(<8 行)整笔不展示", () => {
    const snap = parseReplayFile(JSON.stringify({
      trades: [{ ...goodTrade, series: goodTrade.series.slice(0, 5) }],
    }))
    expect(snap.trades).toHaveLength(0)
  })

  it("未成交单(won=null,filled=false)正常解析", () => {
    const snap = parseReplayFile(JSON.stringify({
      trades: [{ ...goodTrade, won: null, filled: false, matched: 0, pnl: 0 }],
    }))
    expect(snap.trades).toHaveLength(1)
    expect(snap.trades[0].won).toBeNull()
    expect(snap.trades[0].filled).toBe(false)
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

  it("prints 缺省 / postMs 缺省解析为空数组 / null", () => {
    const noPrints = { ...goodTrade } as Record<string, unknown>
    delete noPrints.prints
    delete noPrints.postMs
    const snap = parseReplayFile(JSON.stringify({ trades: [noPrints] }))
    expect(snap.trades).toHaveLength(1)
    expect(snap.trades[0].postMs).toBeNull()
    expect(snap.trades[0].prints).toEqual([])
  })
})
