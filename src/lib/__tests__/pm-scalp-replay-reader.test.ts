import { describe, it, expect } from "vitest"
import { parseReplayFile } from "../pm-scalp-replay-reader"

// btc-v1: btc=[[s, dev_usd]] BTC 相对开盘 strike 的偏离($)，strike=开窗 Chainlink 价
const goodTrade = {
  w: 1783894200,
  _oid: "0xoid-1",
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
  strike: 64181.95,
  btc: Array.from({ length: 300 }, (_, i) => [i, -0.5 - i * 0.05]),
}

describe("parseReplayFile (btc-v1)", () => {
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
    expect(snap.trades[1].strike).toBe(64181.95)
    expect(snap.trades[1].oid).toBe("0xoid-1")
    expect(snap.trades[1].btc[0]).toEqual({ s: 0, dev: -0.5 })
    expect(snap.generated).not.toBe("") // generated_ts → 格式化字符串
  })

  it("畸形笔与畸形行被丢弃,不产生 NaN", () => {
    const snap = parseReplayFile(JSON.stringify({
      trades: [
        { ...goodTrade, limit: "oops" },                       // 整笔丢弃
        { ...goodTrade, strike: null },                        // strike 必填,整笔丢弃
        { ...goodTrade, strike: 0 },                           // strike 必须 >0(bps 分母)
        { ...goodTrade, btc: [[0, null], [5], ...goodTrade.btc] }, // 畸形行丢弃
      ],
    }))
    expect(snap.trades).toHaveLength(1)
    expect(snap.trades[0].btc).toHaveLength(300)
    for (const p of snap.trades[0].btc) {
      expect(Number.isFinite(p.s) && Number.isFinite(p.dev)).toBe(true)
    }
  })

  it("乱序/重复/越界 btc 行被排序/同秒保首个/丢弃", () => {
    const messy = {
      ...goodTrade,
      btc: [
        [3, 1], [1, 0.5], [1, 0.7], [2, 0.6],   // 乱序 + s=1 重复
        [301, 9], [-1, 9], [1.5, 9],             // 越界/非整秒,全丢
        [0, 0], [4, 2], [5, 3], [6, 4], [7, 5], [8, 6],
      ],
    }
    const snap = parseReplayFile(JSON.stringify({ trades: [messy] }))
    expect(snap.trades).toHaveLength(1)
    expect(snap.trades[0].btc.map((p) => p.s)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(snap.trades[0].btc[1].dev).toBe(0.5) // 同秒保留首个
  })

  it("终态不一致的笔整笔丢弃(不给残缺数据编造 0 盈亏/胜负)", () => {
    const noPnl = { ...goodTrade } as Record<string, unknown>
    delete noPnl.pnl
    const snap = parseReplayFile(JSON.stringify({
      trades: [
        noPnl,                             // 成交但缺 pnl
        { ...goodTrade, matched: 0 },      // 成交但 matched=0
        { ...goodTrade, won: "yes" },      // won 非布尔
        { ...goodTrade, filled: false },   // 未成交却带 won/matched
      ],
    }))
    expect(snap.trades).toHaveLength(0)
  })

  it("轨迹残缺(<8 行)整笔不展示", () => {
    const snap = parseReplayFile(JSON.stringify({
      trades: [{ ...goodTrade, btc: goodTrade.btc.slice(0, 5) }],
    }))
    expect(snap.trades).toHaveLength(0)
  })

  it("未成交单(won=null,filled=false,sEntry=null)正常解析", () => {
    const snap = parseReplayFile(JSON.stringify({
      trades: [{
        ...goodTrade,
        won: null, filled: false, matched: 0, pnl: 0, sEntry: null,
      }],
    }))
    expect(snap.trades).toHaveLength(1)
    expect(snap.trades[0].won).toBeNull()
    expect(snap.trades[0].filled).toBe(false)
    expect(snap.trades[0].sEntry).toBeNull()
  })

  it("根 meta.schema 显式非 btc-v1 → 整文件拒收,btc-v1/缺省放行", () => {
    expect(parseReplayFile(JSON.stringify({
      meta: { schema: "btc-v2" }, trades: [goodTrade],
    })).trades).toHaveLength(0)
    expect(parseReplayFile(JSON.stringify({
      meta: { schema: "btc-v1" }, trades: [goodTrade],
    })).trades).toHaveLength(1)
  })

  it("_schema 显式标为非 btc-v1 的笔被丢弃(前向守卫),btc-v1/缺省放行", () => {
    const snap = parseReplayFile(JSON.stringify({
      trades: [
        { ...goodTrade, w: 1783894200, _schema: "tick-v1" },  // 丢弃
        { ...goodTrade, w: 1783905900, _schema: "btc-v1" },   // 放行
        { ...goodTrade, w: 1783917900 },                       // 缺省放行
      ],
    }))
    expect(snap.trades.map((t) => t.w)).toEqual([1783917900, 1783905900])
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

  it("未成交单上 postMs/q/matched/pnl/_oid 缺省 → null/0(不影响解析)", () => {
    const sparse = {
      ...goodTrade, won: null, filled: false,
    } as Record<string, unknown>
    delete sparse.postMs
    delete sparse.q
    delete sparse.matched
    delete sparse.pnl
    delete sparse._oid
    const snap = parseReplayFile(JSON.stringify({ trades: [sparse] }))
    expect(snap.trades).toHaveLength(1)
    expect(snap.trades[0].postMs).toBeNull()
    expect(snap.trades[0].q).toBeNull()
    expect(snap.trades[0].oid).toBeNull()
    expect(snap.trades[0].matched).toBe(0)
    expect(snap.trades[0].pnl).toBe(0)
  })
})
