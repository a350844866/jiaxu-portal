"use client"

import { useState } from "react"
import { Terminal, Loader2, ExternalLink } from "lucide-react"

/**
 * ClaudeSessionCard — 一键在 vault 目录起一个远程控制、bypass 模式的 Claude 会话。
 * 点击 → 宿主 spawn（forced-command，只起空会话）→ 展示 claude.ai 远程控制链接
 * （手机/网页打开即可驱动）。绝不注入任何 prompt。进门户已过 密码+TOTP，无需二次验证。
 */
export function ClaudeSessionCard() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ url: string; session: string } | null>(null)

  async function spawn() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/claude-session/spawn", { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || `失败 (${res.status})`)
      } else {
        setResult({ url: data.url, session: data.session })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "网络错误")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-emerald-400" />
          <h2 className="text-sm font-semibold text-zinc-200">Vault Claude 会话</h2>
        </div>
        <button
          onClick={spawn}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-md bg-emerald-600/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {busy ? "起会话中…" : result ? "再起一个" : "起一个远程会话"}
        </button>
      </div>

      <p className="mt-2 text-xs text-zinc-500">
        在 <code className="text-zinc-400">/programHost/obsidian/jiaxu</code> 起一个 bypass 模式、
        远程控制的 Claude，手机/网页 claude.ai 即可驱动。空会话，不注入任何指令。
      </p>

      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}

      {result && (
        <div className="mt-3 rounded-lg border border-emerald-800/50 bg-emerald-950/30 p-3">
          <p className="text-xs text-zinc-400">
            会话 <code className="text-emerald-300">{result.session}</code> 已就绪 · 远程控制已开
          </p>
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            打开远程控制
          </a>
        </div>
      )}
    </section>
  )
}
