"use client"
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { CircleAlert, RefreshCw, ArrowRight, Coins } from "lucide-react"
import { cn } from "@/lib/utils"
import type { TradeMaxCardData } from "@/lib/trademax-reader"

function fmtAge(sec: number | null): string {
  if (sec == null) return "—"
  if (sec < 60) return `${sec}s 前`
  if (sec < 3600) return `${Math.floor(sec / 60)}min 前`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h 前`
  return `${Math.floor(sec / 86400)}d 前`
}

function fmtUsd(n: number | null | undefined, sign = true): string {
  if (n == null || Number.isNaN(n)) return "—"
  const s = sign && n > 0 ? "+" : ""
  return `${s}$${n.toFixed(2)}`
}

function fmtPct(n: number | null | undefined, sign = true): string {
  if (n == null || Number.isNaN(n)) return "—"
  const s = sign && n > 0 ? "+" : ""
  return `${s}${(n * 100).toFixed(1)}%`
}

function Stat({ n, label, tone }: { n: string; label: string; tone?: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className={cn("text-lg font-semibold tabular-nums", tone ?? "text-zinc-100")}>{n}</span>
      <span className="text-[11px] text-zinc-500">{label}</span>
    </span>
  )
}

export function TradeMaxCard({ account = "trademax" }: { account?: string } = {}) {
  const [data, setData] = useState<TradeMaxCardData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch(`/api/trademax?account=${account}`, { cache: "no-store" })
      const body = await res.json()
      if (!res.ok || body.ok === false) setErr(body.error ?? "trademax 状态读取失败")
      else setData(body)
    } catch {
      setErr("trademax 状态读取失败")
    } finally {
      setLoading(false)
    }
  }, [account])

  useEffect(() => {
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [load])

  const p = data?.sampleProgress

  return (
    <section className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Coins className="h-4 w-4 text-amber-400" />
        <h2 className="text-sm font-semibold text-zinc-200">{data?.label ?? "量化观摩号"}</h2>
        {data && (
          <span className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px]",
            data.stale
              ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
          )}>
            <span className={cn("h-1.5 w-1.5 rounded-full", data.stale ? "bg-amber-400" : "bg-emerald-400 animate-pulse")} />
            {data.stale ? "抓取失联" : "在线"} {fmtAge(data.ageSeconds)}
          </span>
        )}
        {data && data.openPositions > 0 && (
          <span className="rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-300">
            持仓 {data.openPositions}
          </span>
        )}
        <button onClick={load} className="ml-auto text-zinc-600 transition hover:text-zinc-300" aria-label="刷新">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
        <Link href={`/trademax?account=${account}`} className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300">
          反推看板 <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {err && (
        <div className="mt-3 flex items-center gap-2 text-xs text-amber-300">
          <CircleAlert className="h-3.5 w-3.5" /> {err}
        </div>
      )}

      {data && !err && (
        <>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <Stat n={fmtUsd(data.balance, false)} label="余额" />
            <Stat n={fmtUsd(data.netPnl)} label={`净盈亏 ${fmtPct(data.returnPct)}`}
                  tone={data.netPnl >= 0 ? "text-emerald-400" : "text-rose-400"} />
            <Stat n={String(data.nDeals)} label="笔" />
            <Stat n={fmtPct(data.winRate, false)} label="胜率" />
            <Stat n={data.payoff?.toFixed(2) ?? "—"} label="盈亏比"
                  tone={(data.payoff ?? 0) < 1 ? "text-amber-400" : undefined} />
            <Stat n={fmtPct(data.maxDrawdownPct, false)} label="最大回撤" tone="text-zinc-300" />
          </div>

          {p && (
            <div className="mt-3">
              <div className="flex items-baseline justify-between text-[11px] text-zinc-500">
                <span>样本量（判定正期望的门槛）</span>
                <span className="tabular-nums">{p.have} / {p.need}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800/60">
                <div className="h-full rounded-full bg-gradient-to-r from-amber-500/80 to-emerald-500/80"
                     style={{ width: `${p.pct * 100}%` }} />
              </div>
            </div>
          )}

          {data.lastNote && (
            <p className="mt-2 truncate text-[11px] text-zinc-600">最近事件：{data.lastNote}</p>
          )}
        </>
      )}
    </section>
  )
}
