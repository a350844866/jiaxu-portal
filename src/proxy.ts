import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { verifySessionToken, isSetupComplete, COOKIE_NAME } from "@/lib/auth"

const PUBLIC_PATHS = [
  "/auth",
  "/api/auth",
  "/surge-rules",
  "/_next",
  "/favicon.ico",
  // 仅返回 {ok} 的存活探针:portal 自身 /api/health 聚合器经 loopback 探它。
  // 全站要登录后,这条若不放行会让 serenity 卡片误报 down。非敏感、可公开。
  "/api/serenity/health",
  "/api/ai-chain/health",
]

// Host → internal proxy route key
// Host → internal proxy route key (configured via PROXIED_HOSTS env, format: host=key,host=key)
const PROXIED_HOSTS: Record<string, string> = Object.fromEntries(
  (process.env.PROXIED_HOSTS || "").split(",").filter(Boolean).map((e) => e.split("="))
)

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname.startsWith(p))
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const host = request.headers.get("host")?.split(":")[0] || ""

  // ── Proxied service domains ──
  const serviceKey = PROXIED_HOSTS[host]
  if (serviceKey) {
    // Always allow Next.js internals
    if (pathname.startsWith("/_next")) return NextResponse.next()

    // Check JWT cookie
    const token = request.cookies.get(COOKIE_NAME)?.value
    if (token) {
      const valid = await verifySessionToken(token)
      if (valid) {
        // Rewrite to internal proxy route, preserve original path
        return NextResponse.rewrite(
          new URL(`/api/service-proxy/${serviceKey}${pathname}${request.nextUrl.search}`, request.url)
        )
      }
    }

    // Not authenticated → redirect to portal login with return URL
    const proto = request.headers.get("x-forwarded-proto") || "https"
    const originalUrl = `${proto}://${host}${pathname}${request.nextUrl.search}`
    const portalOrigin = process.env.PORTAL_ORIGIN || request.nextUrl.origin
    const loginUrl = new URL("/auth/login", portalOrigin)
    loginUrl.searchParams.set("redirect", originalUrl)
    return NextResponse.redirect(loginUrl)
  }

  // ── Portal routes ──

  // Always allow public paths
  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

  // 全站一律要登录(2026-06-27)。原「内网 isInternalRequest 免登录」已删:
  // isInternalRequest 取最左 x-forwarded-for,CF(灰云)→NPM 链路下最左段可被
  // 外网伪造成私网 IP,实测 `X-Forwarded-For: 192.168.0.1` 即可无登录读 portal
  // (surge 规则/token 成本/持仓等)。改为公网/内网统一 JWT 会话。

  // Check JWT session cookie
  const token = request.cookies.get(COOKIE_NAME)?.value
  if (token) {
    const valid = await verifySessionToken(token)
    if (valid) {
      return NextResponse.next()
    }
  }

  // Not authenticated — redirect to login or setup
  const setupDone = await isSetupComplete()
  const redirectTo = setupDone ? "/auth/login" : "/auth/setup"
  return NextResponse.redirect(new URL(redirectTo, request.url))
}

export const config = {
  matcher: [
    // Match all paths except static files
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
}
