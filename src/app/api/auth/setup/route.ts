import { NextRequest, NextResponse } from "next/server"
import {
  isSetupComplete,
  hashPassword,
  verifyTotp,
  saveConfig,
  generateJwtSecret,
  createSessionToken,
  sessionCookieOptions,
} from "@/lib/auth"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  // Only allow setup once
  if (await isSetupComplete()) {
    return NextResponse.json({ error: "已完成设置，无法重复操作" }, { status: 400 })
  }

  const body = await request.json()
  const { password, totpSecret, totpCode } = body as {
    password: string
    totpSecret: string
    totpCode: string
  }

  if (!password || password.length < 6) {
    return NextResponse.json({ error: "密码至少 6 位" }, { status: 400 })
  }

  if (!totpSecret || !totpCode) {
    return NextResponse.json({ error: "请扫码并输入验证码" }, { status: 400 })
  }

  // Verify the TOTP code matches the secret
  if (!verifyTotp(totpCode, totpSecret)) {
    return NextResponse.json({ error: "验证码不正确，请重试" }, { status: 400 })
  }

  // Save config
  const config = {
    passwordHash: await hashPassword(password),
    totpSecret,
    jwtSecret: generateJwtSecret(),
  }
  await saveConfig(config)

  // Auto-login after setup
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
