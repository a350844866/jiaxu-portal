"use client"
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ScrollText, RefreshCw } from "lucide-react"
import { LOG_GROUPS } from "@/config/log-services"

export function LogHealthCard() {
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch("/api/logs/health?window=1h")
      const data = await res.json()
      if (!res.ok) setErr(data.error ?? "日志源暂不可达")
      else setCounts(data.counts ?? {})
    } catch {
      setErr("日志源暂不可达")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-200">生产日志 · 错误一览</span>
          <span className="text-xs text-zinc-500">近1h · ERROR/异常(绿≠全健康)</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={load} aria-label="刷新" className="text-zinc-500 hover:text-zinc-300">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <Link href="/logs" className="text-xs text-zinc-400 hover:text-zinc-200">
            全部日志 →
          </Link>
        </div>
      </header>

      {err ? (
        <div className="mt-2 text-xs text-rose-400">{err}</div>
      ) : (
        <div className="mt-3 space-y-2">
          {LOG_GROUPS.map((g) => (
            <div key={g.group} className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <span className="w-16 shrink-0 text-xs text-zinc-500">{g.group}</span>
              {g.services.map((s) => {
                const n = counts[s.container] ?? 0
                return (
                  <Link
                    key={s.name}
                    href={`/logs?service=${encodeURIComponent(s.name)}&errorOnly=1`}
                    className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${
                      n > 0
                        ? "border border-rose-500/40 bg-rose-500/10 text-rose-300"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${n > 0 ? "bg-rose-400" : "bg-emerald-500/70"}`}
                    />
                    {s.name}
                    {n > 0 ? ` ${n}` : ""}
                  </Link>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
