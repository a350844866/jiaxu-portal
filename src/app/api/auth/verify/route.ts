// /api/auth/verify — 给 nginx auth_request 用的极简 JWT 校验
// 协议：valid cookie → 204 No Content；无 cookie / 无效 / 过期 → 401
// 不返回 body，不重定向（auth_request 只读 status code）
import { NextRequest, NextResponse } from "next/server"
import { verifySessionToken, COOKIE_NAME } from "@/lib/auth"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value
  if (!token) return new NextResponse(null, { status: 401 })
  const valid = await verifySessionToken(token)
  return new NextResponse(null, { status: valid ? 204 : 401 })
}
