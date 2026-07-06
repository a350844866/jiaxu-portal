"use client"
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Bug, RefreshCw } from "lucide-react"
import type { FeErrorSummary } from "@/lib/fe-errors-pure"

/** type → 色点(沿用 portal zinc 暗色体系) */
const TYPE_DOT: Record<string, string> = {
  vue: "bg-violet-400",
  js: "bg-rose-400",
  promise: "bg-amber-400",
  api: "bg-sky-400",
  resource: "bg-zinc-400",
}

function relTime(utc: string): string {
  const t = new Date(utc).getTime()
  if (isNaN(t)) return ""
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return `${s}秒前`
  if (s < 3600) return `${Math.floor(s / 60)}分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)}小时前`
  return `${Math.floor(s / 86400)}天前`
}

export function FeErrorCard() {
  const [data, setData] = useState<FeErrorSummary | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loginHref, setLoginHref] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    setLoginHref(null)
    try {
      const res = await fetch("/api/logs/fe-errors")
      const body = await res.json()
      if (res.status === 401)
        setLoginHref(`/auth/login?redirect=${encodeURIComponent(window.location.href)}`)
      else if (!res.ok) setErr(body.error ?? "日志源暂不可达")
      else setData(body)
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
          <Bug className="h-4 w-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-200">前端报错 · FE_ERROR</span>
          <span className="text-xs text-zinc-500">近24h · golden 试点</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={load} aria-label="刷新" className="text-zinc-500 hover:text-zinc-300">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <Link
            href={`/logs?service=${encodeURIComponent("golden-service-web")}&keyword=FE_ERROR`}
            className="text-xs text-zinc-400 hover:text-zinc-200"
          >
            原始日志 →
          </Link>
        </div>
      </header>

      {loginHref ? (
        <div className="mt-2 flex items-center gap-2 text-xs">
          <span className="text-zinc-500">未登录 · 生产日志需登录查看</span>
          <Link
            href={loginHref}
            className="rounded border border-zinc-700 px-2 py-0.5 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
          >
            点此登录 →
          </Link>
        </div>
      ) : err ? (
        <div className="mt-2 text-xs text-rose-400">{err}</div>
      ) : !data ? (
        <div className="mt-2 text-xs text-zinc-500">加载中…</div>
      ) : data.total === 0 ? (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-400/80">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/70" />
          24h 无前端错误
        </div>
      ) : (
        <>
          <div className="mt-3 flex items-baseline gap-5">
            <Stat n={data.total} label="条" tone="text-rose-300" />
            <Stat n={data.users} label="人受影响" tone="text-zinc-200" />
            <Stat n={data.sigs} label="个签名" tone="text-zinc-200" />
            {data.parseFailed > 0 && (
              <span className="text-[11px] text-amber-500/80">{data.parseFailed} 行解析失败</span>
            )}
          </div>
          <ul className="mt-3 space-y-1.5">
            {data.top.slice(0, 5).map((e) => (
              <li key={e.sig}>
                <Link
                  href={`/logs?service=${encodeURIComponent("golden-service-web")}&keyword=${encodeURIComponent(e.sig)}`}
                  className="group flex items-start gap-2 rounded px-1 py-0.5 hover:bg-zinc-900"
                >
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${TYPE_DOT[e.type] ?? "bg-zinc-500"}`}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-xs text-zinc-300 group-hover:text-zinc-100">
                      <span className="mr-1.5 text-[10px] uppercase text-zinc-500">{e.type}</span>
                      {e.message || "(无消息)"}
                    </span>
                    <span className="block text-[11px] text-zinc-500">
                      {e.route || "—"} · {e.count}次
                      {e.users > 1 ? ` · ${e.users}人` : ""} · {relTime(e.lastSeenUtc)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function Stat({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className={`text-xl font-semibold tabular-nums ${tone}`}>{n}</span>
      <span className="text-[11px] text-zinc-500">{label}</span>
    </span>
  )
}
