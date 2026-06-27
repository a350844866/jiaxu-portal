import { cookies } from "next/headers"
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth"

/**
 * /api/logs* 会话校验:有有效 portal 会话 cookie 才放行(生产日志敏感)。
 * 全站已统一要登录(proxy.ts 删了内网免登录,2026-06-27);此处保留为
 * 路由层 defense-in-depth,即便上游 middleware 漏放也兜底。
 */
export async function isAuthed(): Promise<boolean> {
  const token = (await cookies()).get(COOKIE_NAME)?.value
  return !!token && (await verifySessionToken(token))
}
