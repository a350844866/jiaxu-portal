import { NextRequest, NextResponse } from "next/server"
import { sessionCookieOptions } from "@/lib/auth"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  // 必须用与登录相同的作用域(domain/path)清 cookie,否则删的是另一把 host-only
  // cookie、真正的 .liulin.work 会话不被删除 → 登出无效(JWT 无状态、不可撤销,
  // 30 天内一直有效)。复用 sessionCookieOptions 保证 domain/path 一致。
  const isSecure = request.headers.get("x-forwarded-proto") === "https"
  const host = request.headers.get("host") || undefined
  const res = NextResponse.json({ ok: true })
  res.cookies.set({
    ...sessionCookieOptions(isSecure, host),
    value: "",
    maxAge: 0,
  })
  return res
}
