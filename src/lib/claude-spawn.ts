/**
 * Claude 会话 spawn — 通过 SSH forced-command 在宿主起一个 idle、远程控制、
 * bypass 模式的 Claude 会话（在 vault 目录），返回 claude.ai 远程控制 URL。
 *
 * 安全边界（多层，见 /home/jiaxu/bin/spawn-vault-claude.sh 注释）：
 *  1. 本端点要求 portal 登录会话 + 每次 fresh TOTP（见 route.ts）。
 *  2. SSH key 在宿主 authorized_keys 里用 command="…" 锁死 → 这把 key 只能跑那个
 *     固定脚本（起 idle vault 会话），SSH_ORIGINAL_COMMAND 被忽略。容器（及其只读
 *     私钥）即使完全失陷，这把 key 也做不了任意 RCE。
 *  3. 起出来的会话只能被持 Anthropic 账号的人驱动（URL 在 claude.ai 侧鉴权），
 *     SSH 调用方驱动不了。
 *  4. 绝不接受 prompt 参数——只起空会话。
 */
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileP = promisify(execFile)

const SSH_KEY = process.env.SPAWN_SSH_KEY || "/data/portal-state/.ssh/id_ed25519_spawn"
const SSH_KNOWN_HOSTS =
  process.env.SPAWN_SSH_KNOWN_HOSTS || "/data/portal-state/.ssh/known_hosts_spawn"
const SSH_TARGET = process.env.SPAWN_SSH_TARGET || "jiaxu@host.docker.internal"

export interface SpawnResult {
  ok: boolean
  url?: string
  session?: string
  error?: string
}

/** SSH 到宿主触发 forced-command 脚本；脚本自身固定动作、忽略我们传的命令。 */
export async function spawnVaultClaude(): Promise<SpawnResult> {
  try {
    const { stdout } = await execFileP(
      "ssh",
      [
        "-i", SSH_KEY,
        "-o", `UserKnownHostsFile=${SSH_KNOWN_HOSTS}`,
        "-o", "StrictHostKeyChecking=yes",
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=5",
        SSH_TARGET,
        "spawn", // 被 forced-command 忽略，仅占位（脚本只记它做审计）
      ],
      { timeout: 35_000, maxBuffer: 64 * 1024 },
    )
    const line = stdout.trim().split("\n").filter(Boolean).pop() || ""
    let parsed: SpawnResult
    try {
      parsed = JSON.parse(line) as SpawnResult
    } catch {
      return { ok: false, error: `宿主返回非预期: ${line.slice(0, 160)}` }
    }
    // 只信任 claude.ai 远程控制 URL 形态，防脚本被替换后回传任意链接
    if (parsed.ok && !/^https:\/\/claude\.ai\/code\/session_[A-Za-z0-9]+$/.test(parsed.url || "")) {
      return { ok: false, error: "宿主返回的 URL 形态非法" }
    }
    return parsed
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg.slice(0, 200) }
  }
}
