import { describe, it, expect } from "vitest"
import { parseHonestScorecard } from "../pm-scalp-honest-reader"

const good = {
  meta: { generated_ts: 1784163714 },
  variants: [
    {
      v: "B1S",
      calm: { n: 76, w: 48, l: 28, winrate: 0.63, pnl: 20.41 },
      allWindow: { n: 656, w: 362, l: 294, winrate: 0.55, pnlOpt: -120.28, pnlFill: -62.55, noOutcome: 136 },
      byDay: [
        { day: "07-13", n: 228, w: 129, l: 99, pnl: -25.0 },
        { day: "07-14", n: 207, w: 113, l: 94, pnl: -50.2 },
      ],
    },
    {
      v: "VN1",
      calm: { n: 49, w: 42, l: 7, winrate: 0.86, pnl: 8.43 },
      allWindow: { n: 102, w: 89, l: 13, winrate: 0.87, pnlOpt: 24.74, pnlFill: 22.05, noOutcome: 9 },
      byDay: [{ day: "07-13", n: 27, w: 27, l: 0, pnl: 20.7 }],
    },
  ],
}

describe("parseHonestScorecard", () => {
  it("解析合法记分板", () => {
    const s = parseHonestScorecard(JSON.stringify(good))
    expect(s.variants).toHaveLength(2)
    expect(s.variants[0].v).toBe("B1S")
    expect(s.variants[0].calm.pnl).toBe(20.41)
    expect(s.variants[0].allWindow.pnlOpt).toBe(-120.28)
    expect(s.variants[0].byDay).toHaveLength(2)
    expect(s.variants[1].byDay[0].pnl).toBe(20.7)
    expect(s.generated).not.toBe("")
  })

  it("缺 calm/allWindow 的变体被丢弃", () => {
    const s = parseHonestScorecard(JSON.stringify({
      variants: [{ v: "X", calm: { n: 1 } }, good.variants[1]],
    }))
    expect(s.variants).toHaveLength(1)
    expect(s.variants[0].v).toBe("VN1")
  })

  it("必填数字畸形 → 整变体丢弃并计 malformed(坏数据不许变成权威的 0)", () => {
    // 2026-07-17 全量 review B-8:损坏的负 PnL 若默默变成 $0 = 高估通道
    const s = parseHonestScorecard(JSON.stringify({
      variants: [
        {
          v: "Y",
          calm: { n: "oops", w: 1, l: 0, winrate: null, pnl: 2 },
          allWindow: { n: 3, w: 2, l: 1, winrate: 0.66, pnlOpt: "x", pnlFill: -1, noOutcome: 0 },
        },
        good.variants[1],
      ],
    }))
    expect(s.variants).toHaveLength(1)
    expect(s.variants[0].v).toBe("VN1")
    expect(s.malformed).toBe(1)
  })

  it("解析 execEV / entryGated / tripwire(缺省兼容旧 JSON)", () => {
    const withNew = {
      ...good,
      variants: [{
        ...good.variants[1],
        execEV: { n: 93, filled: 58, w: 48, l: 10, netSum: 2.73, evPerIntent: 0.0294, winrateFilled: 0.8276, wilsonLB: 0.7109 },
      }],
      entryGated: {
        variants: [
          { v: "XWJ-T10", execEV: { n: 1, filled: 1, w: 0, l: 1, netSum: -4.06, evPerIntent: -4.06, winrateFilled: 0, wilsonLB: 0 }, goDecision: { status: "INSUFFICIENT" } },
          { v: "MC60-T80", execEV: null, goDecision: { status: "CONTROL_EXCLUDED" } },
        ],
        tripwire: { MC60: { status: "FREEZE_SCORING", perDay: 3.6, anchorPerDay: 20.3 } },
      },
    }
    const s = parseHonestScorecard(JSON.stringify(withNew))
    expect(s.variants[0].execEV?.netSum).toBe(2.73)
    expect(s.entryGated).toHaveLength(2)
    expect(s.entryGated[0].goStatus).toBe("INSUFFICIENT")
    expect(s.entryGated[1].execEV).toBeNull()
    expect(s.tripwire.MC60.status).toBe("FREEZE_SCORING")
    // 旧 JSON(无新段)兼容:
    const old = parseHonestScorecard(JSON.stringify(good))
    expect(old.entryGated).toHaveLength(0)
    expect(old.variants[0].execEV).toBeNull()
    expect(old.malformed).toBe(0)
  })

  it("非 JSON / 形状畸形绝不抛错", () => {
    expect(parseHonestScorecard("not json").variants).toHaveLength(0)
    expect(parseHonestScorecard("null").variants).toHaveLength(0)
    expect(parseHonestScorecard("42").variants).toHaveLength(0)
    expect(parseHonestScorecard('{"variants": 42}').variants).toHaveLength(0)
    expect(parseHonestScorecard('{"variants": [null]}').variants).toHaveLength(0)
    expect(parseHonestScorecard('{"variants": [{"calm":{}}]}').variants).toHaveLength(0) // 无 v
  })


  it("ep1 区段(primary 形)归一并入 entryGated 展示", () => {
    const s = parseHonestScorecard(JSON.stringify({
      ...good,
      ep1: {
        variants: [{
          v: "EP1-T",
          primary: { nIntents: 10, creditedFills: 3, filledW: 2, filledL: 1, netSum: -4.2, evPerIntent: -0.42, winrateFilled: 0.667, wilsonLB: 0.21 },
          goDecision: { status: "INSUFFICIENT" },
        }],
        tripwire: { "EP1-T": { status: "insufficient", perDay: 48, anchorPerDay: 118.3 } },
      },
    }))
    expect(s.entryGated).toHaveLength(1)
    expect(s.entryGated[0].v).toBe("EP1-T")
    expect(s.entryGated[0].execEV?.n).toBe(10)
    expect(s.entryGated[0].execEV?.filled).toBe(3)
    expect(s.entryGated[0].goStatus).toBe("INSUFFICIENT")
    expect(s.tripwire["EP1-T"].anchorPerDay).toBe(118.3)
  })
})
