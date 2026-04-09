import { NextRequest, NextResponse } from "next/server"
import {
  getConfig,
  verifyPassword,
  verifyTotp,
  createSessionToken,
  checkRateLimit,
  recordFailedAttempt,
  clearRateLimit,
  sessionCookieOptions,
  COOKIE_NAME,
} from "@/lib/auth"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"

  // Rate limit check
  const limit = checkRateLimit(ip)
  if (!limit.allowed) {
    const minutes = Math.ceil((limit.retryAfterMs || 0) / 60000)
    return NextResponse.json(
      { error: `登录尝试过多，请 ${minutes} 分钟后重试` },
      { status: 429 }
    )
  }

  const config = await getConfig()
  if (!config) {
    return NextResponse.json({ error: "请先完成初始设置" }, { status: 400 })
  }

  const body = await request.json()
  const { password, totp } = body as { password: string; totp: string }

  if (!password || !totp) {
    return NextResponse.json({ error: "密码和验证码不能为空" }, { status: 400 })
  }

  // Verify password
  const pwOk = await verifyPassword(password, config.passwordHash)
  if (!pwOk) {
    recordFailedAttempt(ip)
    return NextResponse.json({ error: "密码或验证码错误" }, { status: 401 })
  }

  // Verify TOTP
  const totpOk = verifyTotp(totp, config.totpSecret)
  if (!totpOk) {
    recordFailedAttempt(ip)
    return NextResponse.json({ error: "密码或验证码错误" }, { status: 401 })
  }

  // Success
  clearRateLimit(ip)
  const token = await createSessionToken(config)
  const isSecure = request.headers.get("x-forwarded-proto") === "https"
  const host = request.headers.get("host")?.split(":")[0] || ""

  const res = NextResponse.json({ ok: true })
  res.cookies.set({
    ...sessionCookieOptions(isSecure, host),
    value: token,
  })
  return res
}
