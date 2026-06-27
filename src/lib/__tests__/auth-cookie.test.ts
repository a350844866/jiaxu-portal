import { describe, it, expect } from "vitest"
import { sessionCookieOptions, COOKIE_NAME } from "@/lib/auth"

const THIRTY_DAYS = 30 * 24 * 60 * 60

describe("sessionCookieOptions", () => {
  it("真实域名 → 设跨子域 Domain(.liulin.work SSO)", () => {
    const o = sessionCookieOptions(true, "portal.liulin.work")
    expect(o.domain).toBe(".liulin.work")
    expect(o.name).toBe(COOKIE_NAME)
    expect(o.secure).toBe(true)
  })

  it("裸 IP host → 不设 Domain(host-only,否则浏览器拒收→登录后 cookie 存不下来)", () => {
    const o = sessionCookieOptions(false, "192.168.31.66")
    expect(o.domain).toBeUndefined()
  })

  it("IP 带端口 → 仍不设 Domain", () => {
    const o = sessionCookieOptions(false, "192.168.31.66:3200")
    expect(o.domain).toBeUndefined()
  })

  it("localhost → 不设 Domain", () => {
    expect(sessionCookieOptions(false, "localhost").domain).toBeUndefined()
  })

  it("空 host → 不设 Domain", () => {
    expect(sessionCookieOptions(false, "").domain).toBeUndefined()
    expect(sessionCookieOptions(false).domain).toBeUndefined()
  })

  it("cookie 有效期 = 30 天", () => {
    expect(sessionCookieOptions(true, "portal.liulin.work").maxAge).toBe(THIRTY_DAYS)
    expect(sessionCookieOptions(false, "192.168.31.66").maxAge).toBe(THIRTY_DAYS)
  })
})
