import { describe, expect, it } from "vitest"
import { migrateLegacy } from "../workstream-legacy"

const ids = ["polymarket", "investing", "company-backend"]
const legacy = { "pm-scalp-trading": "polymarket", "pm-paper-quant": "polymarket", "macro-alpha-fomc": "investing" }

describe("migrateLegacy", () => {
  it("旧 id 的名字迁到新 id，旧键消失", () => {
    expect(migrateLegacy({ "pm-scalp-trading": "polymarket量化", "company-backend": "后端" }, legacy, ids)).toEqual({
      "company-backend": "后端",
      polymarket: "polymarket量化",
    })
  })
  it("显式新 id 优先于旧 id 别名", () => {
    expect(migrateLegacy({ "pm-paper-quant": "旧", polymarket: "新" }, legacy, ids)).toEqual({ polymarket: "新" })
  })
  it("多个旧 id 指向同一新 id 取先出现的", () => {
    expect(migrateLegacy({ "pm-paper-quant": "A", "pm-scalp-trading": "B" }, legacy, ids)).toEqual({ polymarket: "A" })
  })
  it("映射目标不在白名单则丢弃；未知键原样保留交给调用方", () => {
    expect(migrateLegacy({ "macro-alpha-fomc": "x", nope: "y" }, legacy, ["polymarket"])).toEqual({ nope: "y" })
  })
})
