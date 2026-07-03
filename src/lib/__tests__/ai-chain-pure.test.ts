import { describe, expect, it } from "vitest"
import { parseChain, parseQuotes, fmtMcap, fmtPct, fmtPrice } from "@/lib/ai-chain-pure"

const CHAIN_FIXTURE = JSON.stringify({
  version: 1,
  updated: "2026-07-02",
  global: {
    stage: "分化阶段",
    debates: [{ topic: "capex 泡沫论", bear: "revenue gap", bull: "自有现金流" }],
  },
  segments: [
    { id: "compute", order: 2, name: "算力芯片", role: "利润池", focus: ["NVDA"], refs: [] },
    { id: "equipment-eda", order: 1, name: "设备/EDA", role: "卖铲人", focus: [], refs: ["AI出口管制"] },
  ],
  stocks: [
    {
      ticker: "nvda",
      name: "英伟达",
      segment: "compute",
      position: "巨头",
      cp: "yes",
      desc: "GPU",
      note: "Rubin H2",
      signals: [{ date: "2026-05-21", source: "alan", type: "watch", note: "减速键", ref: "alan-x" }],
    },
    {
      ticker: "SMCI",
      name: "美超微",
      segment: "compute",
      position: "pure-play",
      cp: "invalid-value",
      desc: "服务器",
      note: "法律风险",
      holding: true,
      signals: [{ date: "2026-07-02", source: "unknown", type: "nonsense", note: "x" }],
    },
  ],
})

describe("parseChain", () => {
  const chain = parseChain(CHAIN_FIXTURE)

  it("segments 按 order 排序", () => {
    expect(chain.segments.map((s) => s.id)).toEqual(["equipment-eda", "compute"])
  })

  it("ticker 归一大写,信号完整解析", () => {
    const nvda = chain.stocks[0]
    expect(nvda.ticker).toBe("NVDA")
    expect(nvda.holding).toBe(false)
    expect(nvda.signals[0]).toEqual({
      date: "2026-05-21",
      source: "alan",
      type: "watch",
      note: "减速键",
      ref: "alan-x",
    })
  })

  it("非法枚举宽松降级而非抛错(vault 手工维护容错)", () => {
    const smci = chain.stocks[1]
    expect(smci.cp).toBe("no")
    expect(smci.holding).toBe(true)
    expect(smci.signals[0].source).toBe("claude")
    expect(smci.signals[0].type).toBe("watch")
  })

  it("global 拍平到顶层", () => {
    expect(chain.stage).toBe("分化阶段")
    expect(chain.debates).toHaveLength(1)
  })
})

describe("parseQuotes", () => {
  it("ticker 大写归一,非数值转 null", () => {
    const q = parseQuotes(
      JSON.stringify({
        updated: "2026-07-02T23:30:00+08:00",
        quotes: { nvda: { price: 190.12, chg1d: -1.2, chg1m: null, mcap: "bad" } },
      }),
    )
    expect(q.quotes.NVDA.price).toBe(190.12)
    expect(q.quotes.NVDA.chg1m).toBeNull()
    expect(q.quotes.NVDA.mcap).toBeNull()
    expect(q.quotes.NVDA.chgYtd).toBeNull()
  })
})

describe("格式化", () => {
  it("fmtMcap 档位", () => {
    expect(fmtMcap(4.7e12)).toBe("4.7T")
    expect(fmtMcap(89e9)).toBe("89B")
    expect(fmtMcap(2.5e9)).toBe("2.5B")
    expect(fmtMcap(null)).toBe("")
  })
  it("fmtPct 正负号", () => {
    expect(fmtPct(1.23)).toBe("+1.2%")
    expect(fmtPct(-0.5)).toBe("-0.5%")
    expect(fmtPct(null)).toBe("—")
  })
  it("fmtPrice 千元以上去小数", () => {
    expect(fmtPrice(1234.5)).toBe("1235")
    expect(fmtPrice(19.876)).toBe("19.88")
  })
})
