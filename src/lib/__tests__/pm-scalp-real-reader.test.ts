import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  buildRealSnapshot,
  readPmScalpRealSnapshot,
  EXEC_V3_SINCE,
} from "../pm-scalp-real-reader"

/** 固定时间基准: 批次 2 时代(> EXEC_V3_SINCE) */
const T0 = 1783727124 // 2026-07-11 07:45 +08, 真实批次 2 start 时刻
const NOW = T0 + 3600

const OID = "0xaaaa000000000000000000000000000000000000000000000000000000000001"
const OID2 = "0xbbbb000000000000000000000000000000000000000000000000000000000002"
const OTHER = "0xcccc000000000000000000000000000000000000000000000000000000000003"

const start = (collateral: number, ts: number, resumed = 5, capT = 55, capN = 110) =>
  JSON.stringify({ type: "start", collateral, resumed_trades: resumed, caps: { max_trades: capT, max_notional: capN }, ts })

const order = (oid: string, w: number, ts: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "order", w, s: 241, oid, side_up: true, px: 0.34, shares: 5,
    notional: 1.7, disp: 1.0, latency_ms: 1300, cond: "0xcond", title: "t", ts,
    ...extra,
  })

/** taker 成交: 我方是 taker_order_id */
const takerFill = (oid: string, price: string, size: string) => ({
  taker_order_id: oid, price, size, side: "BUY", status: "CONFIRMED",
  trader_side: "TAKER", maker_orders: [{ order_id: OTHER, price: "0.66", matched_amount: size }],
})

/** maker 成交: 我方在 maker_orders 里, fill 顶层是对手 taker 的聚合事件 */
const makerFill = (oid: string, myPx: string, mySize: string) => ({
  taker_order_id: OTHER, price: "0.5", size: "200", side: "BUY", status: "CONFIRMED",
  trader_side: "MAKER",
  maker_orders: [
    { order_id: "0xdddd", price: "0.53", matched_amount: "19" },
    { order_id: oid, price: myPx, matched_amount: mySize },
  ],
})

const settle = (
  oid: string, w: number, ts: number, won: boolean,
  fills: unknown[] | undefined, extra: Record<string, unknown> = {},
) =>
  JSON.stringify({
    type: "settle", w, oid, side_up: true, px: 0.34, matched: 5.0, won,
    pnl: won ? 3.3 : -1.7, outcomeUp: won ? 1.0 : 0.0, fills_sample: fills, ts,
    ...extra,
  })

const paperEntry = (w: number, exec: number, px: number, sideUp = true) =>
  JSON.stringify({ type: "entry", w, v: "N4", mode: "taker", side_up: sideUp, px, sh: 100, fee: 1, s: 242, sig_px: px, exec, ref: "cl" })
const paperMiss = (w: number, exec: number) =>
  JSON.stringify({ type: "miss", w, v: "N4", s: 241, reason: "price_ran", sig_px: 0.34, seen: 0.41, exec })
const paperSettle = (w: number, won: boolean) =>
  JSON.stringify({ type: "settle", w, v: "N4", won, pnl: won ? 200 : -34, outcomeUp: won ? 1.0 : 0.0, src: "gamma" })

const opts = { running: true, nowSec: NOW }

describe("buildRealSnapshot — 所有权与费用", () => {
  it("taker 单: fill 归属我方 oid, 费 = 0.07·p(1-p)·size, 净额与链上口径一致(T2 形态)", () => {
    const snap = buildRealSnapshot(
      [
        start(50.941637, T0),
        order(OID, T0 + 300, T0 + 540),
        settle(OID, T0 + 300, T0 + 900, true, [takerFill(OID, "0.3", "5")]),
      ],
      [], opts,
    )
    const t = snap.trades[0]
    expect(t.status).toBe("won")
    expect(t.lots).toEqual([{ px: 0.3, size: 5, maker: false }])
    expect(t.fillPxAvg).toBeCloseTo(0.3, 6)
    expect(t.fee).toBeCloseTo(0.0735, 4) // 0.07·0.3·0.7·5
    expect(t.netPnl).toBeCloseTo(3.4265, 4) // 5·(1-0.3) − 1.5·... = 3.5 − 0.0735
    expect(snap.netTotal).toBeCloseTo(3.4265, 4)
    expect(snap.realizedEquity).toBeCloseTo(50.941637 + 3.4265, 4)
  })

  it("maker 单: 顶层 trader_side 是对手, 归属靠 maker_orders[].order_id; 零费、价取我方挂单价", () => {
    const snap = buildRealSnapshot(
      [
        start(50.941637, T0),
        order(OID, T0 + 300, T0 + 540, { px: 0.47, notional: 2.35 }),
        settle(OID, T0 + 300, T0 + 900, false, [makerFill(OID, "0.47", "5")], { px: 0.47 }),
      ],
      [], opts,
    )
    const t = snap.trades[0]
    expect(t.status).toBe("lost")
    expect(t.lots).toEqual([{ px: 0.47, size: 5, maker: true }])
    expect(t.fee).toBe(0)
    expect(t.netPnl).toBeCloseTo(-2.35, 4)
    expect(t.makerRatio).toBe(1)
    expect(snap.makerLotRatio).toBe(1)
  })

  it("证据不全(无 fills_sample) → uncertain, 排除出权威合计, 计数+告警", () => {
    const snap = buildRealSnapshot(
      [
        start(50.941637, T0),
        order(OID, T0 + 300, T0 + 540),
        settle(OID, T0 + 300, T0 + 900, true, undefined),
      ],
      [], opts,
    )
    expect(snap.trades[0].status).toBe("uncertain")
    expect(snap.trades[0].netPnl).toBeNull()
    expect(snap.netTotal).toBe(0)
    expect(snap.uncertainCount).toBe(1)
    expect(snap.wins).toBe(0)
    expect(snap.equity.length).toBe(1) // 只有锚点
    expect(snap.alarms.some((a) => a.includes("uncertain"))).toBe(true)
  })

  it("owned size 与 matched 不符(部分证据) → uncertain", () => {
    const snap = buildRealSnapshot(
      [
        start(50.941637, T0),
        order(OID, T0 + 300, T0 + 540),
        settle(OID, T0 + 300, T0 + 900, true, [takerFill(OID, "0.3", "2")]), // 只见 2/5
      ],
      [], opts,
    )
    expect(snap.trades[0].status).toBe("uncertain")
  })
})

describe("buildRealSnapshot — 生命周期", () => {
  it("pending: order 无终态; openCostBound 按 notional 上界", () => {
    const snap = buildRealSnapshot(
      [start(50.941637, T0), order(OID, T0 + 300, T0 + 540)],
      [], opts,
    )
    expect(snap.trades[0].status).toBe("pending")
    expect(snap.pending).toBe(1)
    expect(snap.openCostBound).toBeCloseTo(1.7, 4)
  })

  it("nofill 终态: 不计盈亏不进胜率, 单独计数", () => {
    const snap = buildRealSnapshot(
      [
        start(50.941637, T0),
        order(OID, T0 + 300, T0 + 540),
        JSON.stringify({ type: "nofill", w: T0 + 300, oid: OID, px: 0.34, ts: T0 + 900 }),
      ],
      [], opts,
    )
    expect(snap.trades[0].status).toBe("nofill")
    expect(snap.nofills).toBe(1)
    expect(snap.netTotal).toBe(0)
  })

  it("unresolved 终态 → 状态 + 告警", () => {
    const snap = buildRealSnapshot(
      [
        start(50.941637, T0),
        order(OID, T0 + 300, T0 + 540),
        JSON.stringify({ type: "unresolved", w: T0 + 300, oid: OID, ts: T0 + 900 }),
      ],
      [], opts,
    )
    expect(snap.trades[0].status).toBe("unresolved")
    expect(snap.alarms.some((a) => a.includes("unresolved"))).toBe(true)
  })

  it("冲突终态: 首条生效, 后续告警", () => {
    const snap = buildRealSnapshot(
      [
        start(50.941637, T0),
        order(OID, T0 + 300, T0 + 540),
        settle(OID, T0 + 300, T0 + 900, true, [takerFill(OID, "0.3", "5")]),
        settle(OID, T0 + 300, T0 + 960, false, [takerFill(OID, "0.3", "5")]),
      ],
      [], opts,
    )
    expect(snap.trades[0].status).toBe("won")
    expect(snap.alarms.some((a) => a.includes("conflict"))).toBe(true)
  })

  it("settle 无对应 order → 告警且不进表", () => {
    const snap = buildRealSnapshot(
      [start(50.941637, T0), settle(OID, T0 + 300, T0 + 900, true, [takerFill(OID, "0.3", "5")])],
      [], opts,
    )
    expect(snap.trades.length).toBe(0)
    expect(snap.alarms.some((a) => a.includes("orphan"))).toBe(true)
  })
})

describe("buildRealSnapshot — 权益曲线与检查点", () => {
  it("equity 逐终态累计; start 检查点吻合(±0.01)不告警", () => {
    const snap = buildRealSnapshot(
      [
        start(50.941637, T0 - 7200, 0, 5, 12),
        order(OID, T0 - 7000, T0 - 6900),
        settle(OID, T0 - 7000, T0 - 6600, true, [takerFill(OID, "0.3", "5")]),
        start(54.368137, T0), // 50.941637 + 3.4265 → 吻合
      ],
      [], opts,
    )
    // [SL1 2026-07-12] start 也是链上实测锚点: 曲线在其处重锚（吻合时值不变）
    expect(snap.equity.map((p) => p.balance)).toEqual([
      50.941637,
      expect.closeTo(54.368137, 3),
      expect.closeTo(54.368137, 3),
    ])
    expect(snap.alarms).toEqual([])
    expect(snap.balanceStart).toBe(50.941637)
  })

  it("dump settle(src:dump 无 fills_sample)用 pnl−fees 进权益, 不降级 uncertain", () => {
    const snap = buildRealSnapshot(
      [
        start(29.51, T0, 0, 5, 12),
        order(OID, T0 + 100, T0 + 150, { strategy: "SL1", batch: "sl1-x", pair: T0 + 100 }),
        settle(OID, T0 + 100, T0 + 400, false, undefined,
          { src: "dump", pnl: -1.25, fees: 0.11, sold: 5, proceeds: 0.5 }),
      ],
      [], opts,
    )
    expect(snap.uncertainCount).toBe(0)
    expect(snap.trades[0].status).toBe("lost")
    expect(snap.trades[0].netPnl).toBeCloseTo(-1.36, 6)
    expect(snap.trades[0].fee).toBeCloseTo(0.11, 6)
  })

  it("end 记录的 collateral_end 是终点锚: realizedEquity 精确等于链上", () => {
    const snap = buildRealSnapshot(
      [
        start(29.51, T0, 0, 5, 12),
        order(OID, T0 + 100, T0 + 150, { strategy: "SL1" }),
        settle(OID, T0 + 100, T0 + 400, false, undefined,
          { src: "dump", pnl: -1.25, fees: 0.11 }),
        JSON.stringify({ type: "end", trades: 1, spent: 4.3, collateral_start: 29.51,
          collateral_end: 29.81, ts: T0 + 500 }),
      ],
      [], opts,
    )
    // 保守口径累计 29.51−1.36=28.15, 但 end 锚重锚到链上 29.81
    expect(snap.realizedEquity).toBeCloseTo(29.81, 6)
    expect(snap.equity[snap.equity.length - 1].balance).toBeCloseTo(29.81, 6)
  })

  it("caps.max_pairs 批次按对(distinct 窗口)计", () => {
    const snap = buildRealSnapshot(
      [
        JSON.stringify({ type: "start", collateral: 29.51, resumed_trades: 66,
          caps: { max_pairs: 10, max_notional: 235, loss_stop: 2 }, ts: T0 }),
        order(OID, T0 + 100, T0 + 150, { strategy: "SL1" }),
        order(OID2, T0 + 100, T0 + 151, { strategy: "SL1" }),
      ],
      [], opts,
    )
    expect(snap.batch?.capTrades).toBe(10)
    expect(snap.batch?.denominator).toBe(10)
    expect(snap.batch?.done).toBe(1) // 同窗两腿 = 1 对
  })

  it("start 检查点偏差 >0.01 且无 pending → checkpoint 告警", () => {
    const snap = buildRealSnapshot(
      [
        start(50.941637, T0 - 7200, 0, 5, 12),
        order(OID, T0 - 7000, T0 - 6900),
        settle(OID, T0 - 7000, T0 - 6600, true, [takerFill(OID, "0.3", "5")]),
        start(53.0, T0), // 应为 54.368 → 漂移
      ],
      [], opts,
    )
    expect(snap.alarms.some((a) => a.includes("checkpoint"))).toBe(true)
  })
})

describe("buildRealSnapshot — 批次口径", () => {
  it("以最新 start 为锚: denominator = cap − resumed, done = 批锚后 order 数", () => {
    const snap = buildRealSnapshot(
      [
        start(50.941637, T0 - 7200, 0, 5, 12),
        order(OID2, T0 - 7000, T0 - 6900),
        settle(OID2, T0 - 7000, T0 - 6600, false, [takerFill(OID2, "0.38", "5")]),
        start(47.374277, T0),
        order(OID, T0 + 300, T0 + 540),
      ],
      [], opts,
    )
    expect(snap.batch).toMatchObject({ capTrades: 55, resumed: 5, denominator: 50, done: 1, pending: 1 })
  })
})

describe("buildRealSnapshot — 模拟盘 N4 配对", () => {
  const W = T0 + 300
  const mk = (paperLines: string[], realExtra: Record<string, unknown> = {}, orderTs = T0 + 540) =>
    buildRealSnapshot(
      [
        start(50.941637, T0),
        order(OID, W, orderTs, realExtra),
        settle(OID, W, T0 + 900, true, [takerFill(OID, "0.3", "5")]),
      ],
      paperLines, opts,
    )

  it("exec:3 entry 价差 ≤1c → match", () => {
    const snap = mk([paperEntry(W, 3, 0.31), paperSettle(W, true)])
    expect(snap.trades[0].sim.kind).toBe("entry")
    expect(snap.trades[0].simDivergence).toBe("match")
  })

  it("exec:3 entry 价差 >1c → px-gap", () => {
    const snap = mk([paperEntry(W, 3, 0.36)])
    expect(snap.trades[0].simDivergence).toBe("px-gap")
  })

  it("exec:3 miss → sim-missed; 同窗 entry 优先于 miss", () => {
    expect(mk([paperMiss(W, 3)]).trades[0].simDivergence).toBe("sim-missed")
    expect(mk([paperMiss(W, 3), paperEntry(W, 3, 0.31)]).trades[0].sim.kind).toBe("entry")
  })

  it("方向不同 → side-mismatch", () => {
    const snap = mk([paperEntry(W, 3, 0.31, false)])
    expect(snap.trades[0].simDivergence).toBe("side-mismatch")
  })

  it("侦察时代(实盘 ts < EXEC_V3_SINCE)只有 exec:2 记录 → era-mismatch", () => {
    const oldW = EXEC_V3_SINCE - 600
    const snap = buildRealSnapshot(
      [
        start(50.941637, EXEC_V3_SINCE - 900),
        order(OID, oldW, EXEC_V3_SINCE - 500),
        settle(OID, oldW, EXEC_V3_SINCE - 200, true, [takerFill(OID, "0.3", "5")]),
      ],
      [paperMiss(oldW, 2)], opts,
    )
    expect(snap.trades[0].sim.kind).toBe("era-mismatch")
    expect(snap.trades[0].simDivergence).toBeNull()
  })

  it("无记录 → none", () => {
    const snap = mk([])
    expect(snap.trades[0].sim.kind).toBe("none")
    expect(snap.trades[0].simDivergence).toBeNull()
  })
})

describe("buildRealSnapshot — 畸形字段防线(code review C1/H2)", () => {
  it("matched 非数值 → uncertain + malformed-settle 告警, 不污染合计", () => {
    const snap = buildRealSnapshot(
      [
        start(50.941637, T0),
        order(OID, T0 + 300, T0 + 540),
        settle(OID, T0 + 300, T0 + 900, true, [takerFill(OID, "0.3", "5")], { matched: "bad" }),
      ],
      [], opts,
    )
    expect(snap.trades[0].status).toBe("uncertain")
    expect(snap.netTotal).toBe(0)
    expect(Number.isFinite(snap.realizedEquity)).toBe(true)
    expect(snap.alarms.some((a) => a.includes("malformed-settle"))).toBe(true)
  })

  it("won 是字符串 → uncertain, 不算胜也不算负", () => {
    const snap = buildRealSnapshot(
      [
        start(50.941637, T0),
        order(OID, T0 + 300, T0 + 540),
        settle(OID, T0 + 300, T0 + 900, true, [takerFill(OID, "0.3", "5")], { won: "false" }),
      ],
      [], opts,
    )
    expect(snap.trades[0].status).toBe("uncertain")
    expect(snap.wins + snap.losses).toBe(0)
  })

  it("fill 价格 ≥1(份额价域外) → 不算证据 → uncertain", () => {
    const snap = buildRealSnapshot(
      [
        start(50.941637, T0),
        order(OID, T0 + 300, T0 + 540),
        settle(OID, T0 + 300, T0 + 900, true, [takerFill(OID, "1.5", "5")]),
      ],
      [], opts,
    )
    expect(snap.trades[0].status).toBe("uncertain")
  })

  it("畸形 start 被跳过并告警; 有交易但无有效锚点 → missing-anchor", () => {
    const snap = buildRealSnapshot(
      [
        JSON.stringify({ type: "start", collateral: "junk", ts: T0 }),
        order(OID, T0 + 300, T0 + 540),
        settle(OID, T0 + 300, T0 + 900, true, [takerFill(OID, "0.3", "5")]),
      ],
      [], opts,
    )
    expect(snap.alarms.some((a) => a.includes("malformed-start"))).toBe(true)
    expect(snap.alarms.some((a) => a.includes("missing-anchor"))).toBe(true)
    expect(snap.equity).toEqual([]) // 无锚点不画伪曲线
    expect(Number.isFinite(snap.realizedEquity)).toBe(true)
  })

  it("字符串 notional 的 pending 单仍计入在途占用上界", () => {
    const snap = buildRealSnapshot(
      [start(50.941637, T0), order(OID, T0 + 300, T0 + 540, { notional: "1.7" })],
      [], opts,
    )
    expect(snap.openCostBound).toBeCloseTo(1.7, 4)
  })
})

describe("buildRealSnapshot — 检查点时点资格(code review M4)", () => {
  it("单在检查点之后才结算 → 该检查点无资格, 不发假漂移告警", () => {
    const snap = buildRealSnapshot(
      [
        start(50.941637, T0 - 7200, 0, 5, 12),
        order(OID, T0 - 7000, T0 - 6900),
        start(50.941637, T0), // 此刻上一单仍未结算, 余额没变是对的
        settle(OID, T0 - 7000, T0 + 600, true, [takerFill(OID, "0.3", "5")]), // 结算发生在检查点之后
      ],
      [], opts,
    )
    expect(snap.alarms).toEqual([])
  })
})

describe("buildRealSnapshot — era 严格配对(code review M5/M6)", () => {
  const W = T0 + 300
  const real = (paperLines: string[]) =>
    buildRealSnapshot(
      [
        start(50.941637, T0),
        order(OID, W, T0 + 540),
        settle(OID, W, T0 + 900, true, [takerFill(OID, "0.3", "5")]),
      ],
      paperLines, opts,
    )

  it("同窗 exec:2 entry 不遮蔽 exec:3 entry", () => {
    const snap = real([paperEntry(W, 2, 0.9), paperEntry(W, 3, 0.31)])
    expect(snap.trades[0].sim.kind).toBe("entry")
    expect(snap.trades[0].sim.px).toBe(0.31)
    expect(snap.trades[0].simDivergence).toBe("match")
  })

  it("v3 时代只有 exec:2 记录 → era-mismatch", () => {
    const snap = real([paperEntry(W, 2, 0.31)])
    expect(snap.trades[0].sim.kind).toBe("era-mismatch")
  })

  it("模拟 miss + 实盘未成交 → 不算 sim-missed 背离", () => {
    const snap = buildRealSnapshot(
      [
        start(50.941637, T0),
        order(OID, W, T0 + 540),
        JSON.stringify({ type: "nofill", w: W, oid: OID, px: 0.34, ts: T0 + 900 }),
      ],
      [paperMiss(W, 3)], opts,
    )
    expect(snap.trades[0].sim.kind).toBe("miss")
    expect(snap.trades[0].simDivergence).toBeNull()
  })

  it("行键 oid10 存在且唯一(同窗多单 UI 键安全)", () => {
    const snap = buildRealSnapshot(
      [
        start(50.941637, T0),
        order(OID, W, T0 + 540),
        order(OID2, W, T0 + 560), // 同窗第二单(不同 oid)
      ],
      [], opts,
    )
    const keys = snap.trades.map((t) => t.oid10)
    expect(new Set(keys).size).toBe(2)
  })
})

describe("readPmScalpRealSnapshot — fs 壳", () => {
  let dir: string
  const origEnv = process.env.PM_SCALP_DIR

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "pm-scalp-real-test-"))
    process.env.PM_SCALP_DIR = dir
    await fs.mkdir(path.join(dir, "real"), { recursive: true })
    await fs.mkdir(path.join(dir, "paper"), { recursive: true })
  })

  afterAll(async () => {
    if (origEnv === undefined) delete process.env.PM_SCALP_DIR
    else process.env.PM_SCALP_DIR = origEnv
  })

  it("空态: 文件全缺 → ok 空快照, running=false", async () => {
    const snap = await readPmScalpRealSnapshot()
    expect(snap.ok).toBe(true)
    expect(snap.running).toBe(false)
    expect(snap.trades).toEqual([])
    expect(snap.equity).toEqual([])
    expect(snap.batch).toBeNull()
  })

  it("recon.pid 存在 → running=true; 账本坏行跳过不炸", async () => {
    await fs.writeFile(path.join(dir, "real", "recon.pid"), "12345")
    await fs.writeFile(
      path.join(dir, "real", "recon-ledger.jsonl"),
      ["not json{{{", start(50.941637, T0)].join("\n"),
    )
    const snap = await readPmScalpRealSnapshot()
    expect(snap.running).toBe(true)
    expect(snap.balanceStart).toBe(50.941637)
  })
})
