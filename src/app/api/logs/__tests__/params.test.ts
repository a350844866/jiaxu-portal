import { describe, it, expect } from "vitest"
import { parseLogsParams, parseHealthWindow } from "../params"

describe("parseLogsParams", () => {
  it("默认值", () => {
    const p = parseLogsParams(new URLSearchParams("service=sms-server"))
    expect(p).toMatchObject({
      service: "sms-server",
      container: "sms-server",
      window: "30m",
      limit: 200,
      errorOnly: false,
    })
    expect(p.keyword).toBeUndefined()
  })
  it("4gcard → container my4gcard", () => {
    expect(parseLogsParams(new URLSearchParams("service=4gcard")).container).toBe("my4gcard")
  })
  it("非法 window → BAD_WINDOW", () => {
    expect(() =>
      parseLogsParams(new URLSearchParams("service=sms-server&window=99y"))
    ).toThrow("BAD_WINDOW")
  })
  it("未知 service → BAD_SERVICE", () => {
    expect(() => parseLogsParams(new URLSearchParams("service=nope"))).toThrow("BAD_SERVICE")
  })
  it("limit 越界回钳 / 非法回默认", () => {
    expect(parseLogsParams(new URLSearchParams("service=sms-server&limit=99999")).limit).toBe(1000)
    expect(parseLogsParams(new URLSearchParams("service=sms-server&limit=0")).limit).toBe(1)
    expect(parseLogsParams(new URLSearchParams("service=sms-server&limit=abc")).limit).toBe(200)
  })
  it("keyword 含管道 → BAD_KEYWORD", () => {
    expect(() =>
      parseLogsParams(new URLSearchParams("service=sms-server&keyword=a|b"))
    ).toThrow("BAD_KEYWORD")
  })
  it("errorOnly=1 → true", () => {
    expect(parseLogsParams(new URLSearchParams("service=sms-server&errorOnly=1")).errorOnly).toBe(true)
  })
})

describe("parseHealthWindow", () => {
  it("默认 1h", () => {
    expect(parseHealthWindow(new URLSearchParams())).toBe("1h")
  })
  it("非法 → BAD_WINDOW", () => {
    expect(() => parseHealthWindow(new URLSearchParams("window=zzz"))).toThrow("BAD_WINDOW")
  })
})
