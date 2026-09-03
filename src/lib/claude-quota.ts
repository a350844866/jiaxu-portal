/**
 * claude-quota — 读宿主写的 Claude Max 官方配额帧(服务端, 只读 /data/portal-state/claude-quota.json).
 * 解析/口径全在 claude-quota-pure.ts; 本模块只管 fs 与 ENOENT 区分. 永不 throw、永不挂
 * (读一个 1.4KB 文件也带 2s 超时), 让 /api/token/rate-limits 在 DB 正常时不因配额帧整体 503.
 */
import { promises as fs } from "node:fs"
import path from "node:path"
import { parseQuotaFrame, type ClaudeQuota } from "./claude-quota-pure"

const STATE_DIR = process.env.PORTAL_STATE_DIR || "/data/portal-state"
const QUOTA_PATH = path.join(STATE_DIR, "claude-quota.json")
const READ_TIMEOUT_MS = 2000
/** 正常帧 ~1.5KB; 采样器写疯了也不让请求路径整文件读进内存 + 同步 JSON.parse */
const MAX_BYTES = 256 * 1024

export async function fetchClaudeQuota(nowMs: number = Date.now()): Promise<ClaudeQuota> {
  try {
    const st = await fs.stat(QUOTA_PATH)
    if (st.size > MAX_BYTES) {
      return { ok: false, error: `配额帧过大(${st.size}B > ${MAX_BYTES}B), 查宿主采样器`, sampled_at: null, age_seconds: null, stale: true }
    }
    const raw = await fs.readFile(QUOTA_PATH, { encoding: "utf8", signal: AbortSignal.timeout(READ_TIMEOUT_MS) })
    return parseQuotaFrame(raw, nowMs)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? (e as Error)?.name ?? "unknown"
    return {
      ok: false,
      // 明确区分"还没生成过"和"读坏了" —— 前者是宿主 timer 未跑, 后者要查宿主.
      // 只透出错误码, 不把宿主绝对路径/原始 message 带进 API 与 DOM.
      error:
        code === "ENOENT"
          ? "配额帧尚未生成(宿主 claude-quota-sample.timer 未跑过?)"
          : code === "ABORT_ERR" || code === "AbortError" || code === "TimeoutError"
            ? `读配额帧超时(>${READ_TIMEOUT_MS}ms)`
            : `读配额帧失败(${code})`,
      sampled_at: null,
      age_seconds: null,
      stale: true,
    }
  }
}

export type { ClaudeQuota, QuotaWindow, QuotaLimit } from "./claude-quota-pure"
