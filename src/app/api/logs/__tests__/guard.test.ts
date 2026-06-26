import { describe, it, expect, beforeEach, vi } from "vitest"

// ── Fake ambient request context (unavoidable: isAuthed reads next/headers) ──
const { headerStore, cookieStore } = vi.hoisted(() => ({
  headerStore: new Map<string, string>(),
  cookieStore: new Map<string, string>(),
}))

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (k: string) => headerStore.get(k.toLowerCase()) ?? null,
  }),
  cookies: async () => ({
    get: (k: string) => {
      const v = cookieStore.get(k)
      return v === undefined ? undefined : { value: v }
    },
  }),
}))

// Keep the REAL isInternalRequest + COOKIE_NAME; only stub verifySessionToken
// (it reads on-disk config + verifies JWT).
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>()
  return {
    ...actual,
    verifySessionToken: vi.fn(async (t: string) => t === "valid-token"),
  }
})

import { isAuthed } from "../guard"
import { COOKIE_NAME } from "@/lib/auth"

function withRequest(opts: { forwarded?: string; host?: string; cookie?: string }) {
  headerStore.clear()
  cookieStore.clear()
  if (opts.forwarded) headerStore.set("x-forwarded-for", opts.forwarded)
  if (opts.host) headerStore.set("host", opts.host)
  if (opts.cookie) cookieStore.set(COOKIE_NAME, opts.cookie)
}

// SECURITY CONTRACT: /api/logs* proxies sensitive production logs and must ALWAYS
// require a valid portal session cookie — even for "internal" requests. Unlike the
// global proxy.ts middleware, this gate deliberately does NOT honor isInternalRequest,
// because the internal signal (leftmost x-forwarded-for) is client-spoofable through
// the CF(grey)→NPM chain, which would otherwise expose prod logs to the public internet.
describe("isAuthed — /api/logs 会话门禁(生产日志,登录必需)", () => {
  beforeEach(() => {
    headerStore.clear()
    cookieStore.clear()
  })

  it("内网请求(私网 x-forwarded-for) 无 cookie 仍拒绝 — 不走全站内网免登录(XFF 可伪造)", async () => {
    withRequest({ forwarded: "192.168.31.50", host: "portal.liulin.work" })
    expect(await isAuthed()).toBe(false)
  })

  it("内网请求(host 为内网 IP) 无 cookie 仍拒绝", async () => {
    withRequest({ host: "192.168.31.66:3200" })
    expect(await isAuthed()).toBe(false)
  })

  it("公网请求 无 cookie → 拒绝(未登录)", async () => {
    withRequest({ forwarded: "203.0.113.5", host: "portal.liulin.work" })
    expect(await isAuthed()).toBe(false)
  })

  it("有效 cookie → 放行(内网/公网一视同仁)", async () => {
    withRequest({ forwarded: "203.0.113.5", host: "portal.liulin.work", cookie: "valid-token" })
    expect(await isAuthed()).toBe(true)
  })

  it("无效 cookie → 拒绝", async () => {
    withRequest({ forwarded: "192.168.31.50", host: "portal.liulin.work", cookie: "bogus" })
    expect(await isAuthed()).toBe(false)
  })
})
