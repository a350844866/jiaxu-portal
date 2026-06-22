import { describe, it, expect } from "vitest"
import {
  quoteLogsQLString,
  buildQueryLogsQL,
  buildHealthLogsQL,
  containerFromStream,
  parseLogLines,
  aggregateHealth,
} from "../vlogs-pure"

describe("quoteLogsQLString", () => {
  it("转义引号反斜杠", () => {
    expect(quoteLogsQLString('a"b\\c')).toBe('"a\\"b\\\\c"')
  })
  it("允许空格/中文/连字符", () => {
    expect(quoteLogsQLString("订单 123-x")).toBe('"订单 123-x"')
  })
  it("拒绝管道/控制字符", () => {
    expect(() => quoteLogsQLString("x | stats")).toThrow("BAD_KEYWORD")
    expect(() => quoteLogsQLString("x\n")).toThrow("BAD_KEYWORD")
  })
})

describe("buildQueryLogsQL", () => {
  it("基本", () => {
    expect(
      buildQueryLogsQL({ container: "sms-server", window: "30m", limit: 200 })
    ).toBe('_time:30m {path=~".*sms-server.*"} | limit 200')
  })
  it("errorOnly 用预设", () => {
    const q = buildQueryLogsQL({
      container: "auth-web",
      window: "1h",
      errorOnly: true,
      limit: 50,
    })
    expect(q).toContain('{path=~".*auth-web.*"}')
    expect(q).toContain("exceptionHandler")
    expect(q).toContain("| limit 50")
  })
  it("keyword 被引号包裹", () => {
    expect(
      buildQueryLogsQL({ container: "x", window: "1h", keyword: "订单123", limit: 10 })
    ).toContain('"订单123"')
  })
})

it("buildHealthLogsQL", () => {
  expect(buildHealthLogsQL("1h")).toBe(
    '_time:1h ("exceptionHandler" OR "Got unchecked and undeclared exception") | stats by (_stream) count() c'
  )
})

it("containerFromStream 提取容器名(剥 pod/container id)", () => {
  const s =
    '{path="/var/log/containers/sms-server-66d_ccse-ns-prod_sms-server-abc123def456789.log",stream="stdout"}'
  expect(containerFromStream(s)).toBe("sms-server")
})

describe("parseLogLines", () => {
  it("解析 + 倒序 + level + 北京时间", () => {
    const ndjson = [
      JSON.stringify({ _time: "2026-06-22T01:00:00Z", _msg: "... INFO foo" }),
      JSON.stringify({ _time: "2026-06-22T02:00:00Z", _msg: "[ERROR] boom" }),
    ].join("\n")
    const lines = parseLogLines(ndjson, "sms-server")
    expect(lines.length).toBe(2)
    expect(lines[0].tUtc).toBe("2026-06-22T02:00:00Z") // 倒序,最新在上
    expect(lines[0].level).toBe("ERROR")
    expect(lines[1].level).toBe("INFO")
    expect(lines[0].container).toBe("sms-server")
    expect(lines[1].tLocal).toBe("2026-06-22 09:00:00") // 01:00Z +8h
  })
  it("坏 JSON 抛 parse", () => {
    expect(() => parseLogLines("not json", "x")).toThrow()
  })
})

describe("aggregateHealth", () => {
  it("同容器多 pod 累加 + 过滤非目标", () => {
    const ndjson = [
      JSON.stringify({
        _stream:
          '{path="/var/log/containers/p1_ccse-ns-prod_sms-server-aaaaaaaaaaaa.log"}',
        c: "3",
      }),
      JSON.stringify({
        _stream:
          '{path="/var/log/containers/p2_ccse-ns-prod_sms-server-bbbbbbbbbbbb.log"}',
        c: "2",
      }),
      JSON.stringify({
        _stream:
          '{path="/var/log/containers/p3_ccse-ns-prod_other-thing-cccccccccccc.log"}',
        c: "9",
      }),
    ].join("\n")
    const counts = aggregateHealth(ndjson, ["sms-server"])
    expect(counts["sms-server"]).toBe(5) // 3+2
    expect(counts["other-thing"]).toBeUndefined()
  })
})
