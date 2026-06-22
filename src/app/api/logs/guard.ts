import { cookies } from "next/headers"
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth"

/**
 * /api/logs* 会话校验:有有效 portal 会话 cookie 才放行。
 * 比首页遥测 API(token/metrics 等当前未在路由层设防)更严——生产日志敏感得多。
 */
export async function isAuthed(): Promise<boolean> {
  const token = (await cookies()).get(COOKIE_NAME)?.value
  return !!token && (await verifySessionToken(token))
}
