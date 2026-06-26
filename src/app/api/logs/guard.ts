import { cookies } from "next/headers"
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth"

/**
 * /api/logs* 会话校验:有有效 portal 会话 cookie 才放行。
 * 比首页遥测 API(token/metrics 等当前未在路由层设防)更严——生产日志敏感得多。
 *
 * ⚠ 故意 NOT 复用 proxy.ts 的「内网 isInternalRequest 免登录」:那条判定取
 * x-forwarded-for 最左段,在 CF(灰云)→NPM 链路下可被外部客户端伪造成私网 IP,
 * 等于把生产日志暴露给公网。生产日志必须始终要求登录,内网也不例外。
 * (前端遇 401 应引导登录,而非内网放行——见 LogHealthCard / LogsPanel。)
 */
export async function isAuthed(): Promise<boolean> {
  const token = (await cookies()).get(COOKIE_NAME)?.value
  return !!token && (await verifySessionToken(token))
}
