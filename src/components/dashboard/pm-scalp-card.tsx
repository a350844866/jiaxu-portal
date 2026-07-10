"use client"
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Timer, RefreshCw, ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"
import type { PmScalpSnapshot } from "@/lib/pm-scalp-reader"

function fmtAge(sec: number | null | undefined): string {
  if (sec == null) return "—"
  if (sec < 60) return `${sec}s 前`
  if (sec < 3600) return `${Math.floor(sec / 60)}min 前`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h 前`
  return `${Math.floor(sec / 86400)}d 前`
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—"
  const sign = n > 0 ? "+" : ""
  return `${sign}$${n.toFixed(2)}`
}

function Stat({ n, label }: { n: number | string | null; label: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-lg font-semibold tabular-nums text-zinc-100">{n ?? "—"}</span>
      <span className="text-[11px] text-zinc-500">{label}</span>
    </span>
  )
}

export function PmScalpCard() {
  const [data, setData] = useState<PmScalpSnapshot | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch("/api/pm-scalp", { cache: "no-store" })
      const body = await res.json()
      if (!res.ok) setErr(body.error ?? "pm-scalp 状态读取失败")
      else setData(body)
    } catch {
      setErr("pm-scalp 状态读取失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const totals = data?.totals
  const winrate =
    totals && totals.settled > 0 ? `${((totals.wins / totals.settled) * 100).toFixed(0)}%` : "—"
  // 与 /pm-scalp 页 FreshDot 同语义:绿 ≤1×阈值 / 黄 ≤4×阈值 / 红 更旧或缺失
  const dotClass = (sec: number | null | undefined, staleAfter: number) =>
    sec == null
      ? "bg-zinc-600"
      : sec <= staleAfter
        ? "bg-emerald-500"
        : sec <= staleAfter * 4
          ? "bg-amber-500"
          : "bg-rose-500"

  return (
    <section className="group relative mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4 transition-colors hover:border-zinc-700/80 hover:bg-zinc-900/40">
      {/* 同 pm-paper-card:整卡 Link 覆盖层 + pointer-events-none 内容层,刷新按钮自开 pointer-events */}
      <Link
        href="/pm-scalp"
        className="absolute inset-0 z-0 rounded-2xl"
        aria-label="查看 pm-scalp 完整看板"
      />

      <div className="pointer-events-none relative z-10">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Timer className="h-4 w-4 text-zinc-400" />
            <span className="text-sm font-medium text-zinc-200">pm-scalp 微结构</span>
            <span className="text-xs text-zinc-500">BTC 5min 末段噪声回归</span>
          </div>
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              load()
            }}
            aria-label="刷新"
            className="pointer-events-auto relative z-20 text-zinc-500 hover:text-zinc-300"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </header>

        {err ? (
          <div className="mt-2 text-xs text-rose-400">{err}</div>
        ) : !data ? (
          <div className="mt-2 text-xs text-zinc-500">加载中…</div>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-2">
              <Stat n={data.windowsRecorded} label="窗口覆盖" />
              <Stat n={totals?.settled ?? null} label="已结算" />
              <Stat n={winrate} label="胜率" />
              <Stat n={totals?.open ?? null} label="持仓中" />
              <span className="flex items-baseline gap-1">
                <span className={cn("text-lg font-semibold tabular-nums", (totals?.pnl ?? 0) > 0 ? "text-emerald-400" : (totals?.pnl ?? 0) < 0 ? "text-rose-400" : "text-zinc-100")}>
                  {fmtUsd(totals?.pnl)}
                </span>
                <span className="text-[11px] text-zinc-500">
                  P&amp;L{totals?.roiOnCost != null && (
                    <> · {totals.roiOnCost > 0 ? "+" : ""}{(totals.roiOnCost * 100).toFixed(1)}%</>
                  )}
                </span>
              </span>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
              <span className="flex items-center gap-1.5">
                <span className={cn("inline-block h-2 w-2 rounded-full", dotClass(data.dataAgeSeconds, 15))} />
                <span className="text-zinc-500">记录器 {fmtAge(data.dataAgeSeconds)}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className={cn("inline-block h-2 w-2 rounded-full", dotClass(data.heartbeatAgeSeconds, 45))} />
                <span className="text-zinc-500">执行器 {fmtAge(data.heartbeatAgeSeconds)}</span>
              </span>
              {data.basis && (
                <span className="text-zinc-500">
                  基差 <span className="tabular-nums text-zinc-400">${data.basis.usd.toFixed(0)}</span>
                </span>
              )}
              <span className="text-zinc-600">判定日 {data.judgmentDate}</span>
            </div>

            <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-600">
              <span>cl-only 干净账本 · 六变体并行 forward test</span>
              <span className="flex items-center gap-1 text-zinc-500 opacity-0 transition-opacity group-hover:opacity-100">
                查看完整看板 <ArrowRight className="h-3 w-3" />
              </span>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
