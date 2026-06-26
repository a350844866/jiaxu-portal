"use client"
import { useCallback, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { LOG_GROUPS } from "@/config/log-services"
import type { LogLine } from "@/lib/vlogs-pure"

const WINDOWS = ["15m", "30m", "1h", "3h", "6h", "1d"]
const LEVEL_COLOR: Record<string, string> = {
  FATAL: "text-rose-500",
  ERROR: "text-rose-400",
  WARN: "text-amber-400",
  INFO: "text-zinc-400",
  DEBUG: "text-zinc-600",
  TRACE: "text-zinc-600",
}

export function LogsPanel() {
  const router = useRouter()
  const sp = useSearchParams()
  const [service, setService] = useState(sp.get("service") ?? "sms-server")
  const [win, setWin] = useState(sp.get("window") ?? "30m")
  const [keyword, setKeyword] = useState(sp.get("keyword") ?? "")
  const [errorOnly, setErrorOnly] = useState(sp.get("errorOnly") === "1")
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [lines, setLines] = useState<LogLine[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [loginHref, setLoginHref] = useState<string | null>(null)

  const run = useCallback(async () => {
    setLoading(true)
    setErr(null)
    setLoginHref(null)
    const q = new URLSearchParams({ service, window: win, errorOnly: errorOnly ? "1" : "0" })
    if (keyword.trim()) q.set("keyword", keyword.trim())
    router.replace(`/logs?${q.toString()}`, { scroll: false })
    try {
      const res = await fetch(`/api/logs?${q.toString()}`)
      const data = await res.json()
      if (res.status === 401) {
        setLoginHref(`/auth/login?redirect=${encodeURIComponent(window.location.href)}`)
        setLines([])
      } else if (!res.ok) {
        setErr(data.error ?? "查询失败")
        setLines([])
      } else {
        setLines(data.lines ?? [])
      }
    } catch {
      setErr("网络错误")
      setLines([])
    } finally {
      setLoading(false)
    }
  }, [service, win, keyword, errorOnly, router])

  // 首次进页查一次
  useEffect(() => {
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 自动刷新 5s
  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(() => run(), 5000)
    return () => clearInterval(id)
  }, [autoRefresh, run])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select
          value={service}
          onChange={(e) => setService(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200"
        >
          {LOG_GROUPS.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.services.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <select
          value={win}
          onChange={(e) => setWin(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200"
        >
          {WINDOWS.map((w) => (
            <option key={w} value={w}>
              近 {w}
            </option>
          ))}
        </select>
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="关键词(可选)"
          className="w-40 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200"
        />
        <label className="flex items-center gap-1 text-xs text-zinc-400">
          <input type="checkbox" checked={errorOnly} onChange={(e) => setErrorOnly(e.target.checked)} />
          只看错误
        </label>
        <label className="flex items-center gap-1 text-xs text-zinc-400">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          自动刷新5s
        </label>
        <button
          onClick={run}
          disabled={loading}
          className="rounded bg-zinc-200 px-3 py-1 text-xs font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
        >
          {loading ? "查询中…" : "查询"}
        </button>
      </div>

      {loginHref && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-zinc-500">未登录 · 生产日志需登录查看</span>
          <a
            href={loginHref}
            className="rounded border border-zinc-700 px-2 py-0.5 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
          >
            点此登录 →
          </a>
        </div>
      )}

      {err && <div className="text-sm text-rose-400">{err}</div>}

      {!err && !loginHref && lines.length === 0 && !loading && (
        <div className="text-sm text-zinc-500">该条件下无日志。</div>
      )}

      <div className="space-y-1 font-mono text-xs">
        {lines.map((l, i) => (
          <details key={i} className="rounded border border-zinc-800/60 bg-zinc-950/40 px-2 py-1">
            <summary className="flex cursor-pointer list-none items-baseline gap-2">
              <span className="shrink-0 text-zinc-500">{l.tLocal}</span>
              <span className={`shrink-0 font-medium ${LEVEL_COLOR[l.level] ?? "text-zinc-500"}`}>{l.level}</span>
              <span className="truncate text-zinc-300">{l.msg}</span>
            </summary>
            <pre className="mt-1 whitespace-pre-wrap break-all text-zinc-400">{l.msg}</pre>
          </details>
        ))}
      </div>
    </div>
  )
}
