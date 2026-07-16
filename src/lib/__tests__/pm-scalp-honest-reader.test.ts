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

  it("畸形数字降级为默认值不产生 NaN", () => {
    const s = parseHonestScorecard(JSON.stringify({
      variants: [{
        v: "Y",
        calm: { n: "oops", w: 1, l: 0, winrate: null, pnl: 2 },
        allWindow: { n: 3, w: 2, l: 1, winrate: 0.66, pnlOpt: "x", pnlFill: -1, noOutcome: 0 },
        byDay: [{ day: "07-16", n: 3, pnl: "bad" }],
      }],
    }))
    expect(s.variants).toHaveLength(1)
    expect(s.variants[0].calm.n).toBe(0) // "oops" → 0
    expect(s.variants[0].allWindow.pnlOpt).toBe(0) // "x" → 0
    expect(s.variants[0].byDay[0].pnl).toBe(0) // "bad" → 0
    expect(Number.isNaN(s.variants[0].allWindow.pnlOpt)).toBe(false)
  })

  it("非 JSON / 形状畸形绝不抛错", () => {
    expect(parseHonestScorecard("not json").variants).toHaveLength(0)
    expect(parseHonestScorecard("null").variants).toHaveLength(0)
    expect(parseHonestScorecard("42").variants).toHaveLength(0)
    expect(parseHonestScorecard('{"variants": 42}').variants).toHaveLength(0)
    expect(parseHonestScorecard('{"variants": [null]}').variants).toHaveLength(0)
    expect(parseHonestScorecard('{"variants": [{"calm":{}}]}').variants).toHaveLength(0) // 无 v
  })
})
