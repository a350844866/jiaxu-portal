"use client"
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Timer, RefreshCw, ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"
import type { PmScalpSnapshot } from "@/lib/pm-scalp-reader"
import type { PmScalpRealSnapshot } from "@/lib/pm-scalp-real-reader"

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
  const [real, setReal] = useState<PmScalpRealSnapshot | null>(null)
  const [realErr, setRealErr] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    // allSettled: 实盘接口失败不拖垮模拟盘展示, 反之亦然
    const [paperRes, realRes] = await Promise.allSettled([
      fetch("/api/pm-scalp", { cache: "no-store" }).then(async (r) => {
        const body = await r.json()
        if (!r.ok) throw new Error(body.error ?? "fail")
        return body as PmScalpSnapshot
      }),
      fetch("/api/pm-scalp/real", { cache: "no-store" }).then(async (r) => {
        const body = await r.json()
        if (!r.ok) throw new Error(body.error ?? "fail")
        return body as PmScalpRealSnapshot
      }),
    ])
    if (paperRes.status === "fulfilled") setData(paperRes.value)
    else setErr("pm-scalp 状态读取失败")
    if (realRes.status === "fulfilled") {
      setReal(realRes.value)
      setRealErr(false)
    } else setRealErr(true)
    setLoading(false)
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
                    <> · 每$1投入{totals.roiOnCost > 0 ? "+" : ""}{(totals.roiOnCost * 100).toFixed(1)}%</>
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

            {/* 实盘 LIVE 行: 独立数据源, 整行可点直达实盘页(兄弟层级, 沿用刷新按钮的分层模式) */}
            {realErr ? (
              <div className="mt-3 border-t border-zinc-800/60 pt-2 text-[11px] text-zinc-600">实盘数据不可用</div>
            ) : real ? (
              <Link
                href="/pm-scalp/real"
                className="pointer-events-auto relative z-20 mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border-t border-zinc-800/60 pt-2 text-[11px] hover:bg-zinc-800/30"
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "inline-block h-2 w-2 rounded-full",
                      real.running && (real.lastEventAgeSeconds ?? 1e9) < 3600
                        ? "animate-pulse bg-emerald-500"
                        : real.running
                          ? "bg-amber-500"
                          : "bg-zinc-600",
                    )}
                  />
                  <span className="font-medium text-rose-300/90">LIVE 实盘</span>
                </span>
                <span className="tabular-nums text-zinc-300">${real.realizedEquity.toFixed(2)}</span>
                <span
                  className={cn(
                    "font-semibold tabular-nums",
                    real.netTotal > 0 ? "text-emerald-400" : real.netTotal < 0 ? "text-rose-400" : "text-zinc-400",
                  )}
                >
                  {real.netTotal > 0 ? "+" : ""}
                  {real.netTotal.toFixed(2)}
                </span>
                <span className="text-zinc-500">
                  {real.wins}胜{real.losses}负
                  {real.batch && ` · 本批 ${real.batch.done}/${real.batch.denominator}`}
                </span>
              </Link>
            ) : null}

            <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-600">
              <span>固定虚拟注 $100/笔 · 无本金池 · cl-only 干净账本</span>
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
