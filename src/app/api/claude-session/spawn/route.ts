/**
 * POST /api/claude-session/spawn
 * 在 vault 目录起一个 idle、远程控制、bypass 模式的 Claude 会话，返回 claude.ai URL。
 *
 * 安全姿态（2026-07-12 用户判断：去掉二次 TOTP）——真正的门是结构性的两道：
 *  1. 进门户本身要 密码 + TOTP，故有效 session cookie 已是强凭证；本端点校验它。
 *  2. 起出来的会话只有持 Anthropic 账号者能驱动（claude.ai URL 侧鉴权），SSH 调用方
 *     驱动不了。宿主 key 又是 forced-command，只能起空会话（见 spawn-vault-claude.sh）。
 * ⇒ 偷到 cookie 的攻击者最坏只能造几个闲置会话（驱动不了）——DoS 级，非 RCE。
 * 兜底：每 IP 限流 + 宿主 6 会话上限。绝不接受任何 prompt 参数。
 */
import { NextRequest, NextResponse } from "next/server"
import { verifySessionToken, clientIp, COOKIE_NAME } from "@/lib/auth"
import { spawnVaultClaude } from "@/lib/claude-spawn"

export const dynamic = "force-dynamic"

// ── spawn 限流（内存，每 IP 20s 一次；挡误点/骚扰刷）──
const lastSpawn = new Map<string, number>()
const SPAWN_COOLDOWN_MS = 20_000

export async function POST(request: NextRequest) {
  const ip = clientIp(request.headers.get("x-real-ip"), request.headers.get("x-forwarded-for"))

  // 1) 登录会话（进门户已过 密码+TOTP，此 cookie 即强凭证）
  const token = request.cookies.get(COOKIE_NAME)?.value
  if (!token || !(await verifySessionToken(token))) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  // 2) 限流
  const last = lastSpawn.get(ip)
  if (last && Date.now() - last < SPAWN_COOLDOWN_MS) {
    const wait = Math.ceil((SPAWN_COOLDOWN_MS - (Date.now() - last)) / 1000)
    return NextResponse.json({ error: `请 ${wait}s 后再试` }, { status: 429 })
  }
  lastSpawn.set(ip, Date.now())

  // 触发宿主 spawn（forced-command，只起空会话）
  console.log(`[claude-spawn] spawn requested ip=${ip} at ${new Date().toISOString()}`)
  const result = await spawnVaultClaude()
  console.log(`[claude-spawn] result ok=${result.ok} session=${result.session || "-"} err=${result.error || "-"}`)

  if (!result.ok) {
    return NextResponse.json({ error: result.error || "spawn 失败" }, { status: 502 })
  }
  return NextResponse.json({ ok: true, url: result.url, session: result.session })
}
