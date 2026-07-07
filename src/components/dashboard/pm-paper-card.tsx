"use client"
import { useCallback, useEffect, useState } from "react"
import { LineChart, CircleAlert, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import type { PmPaperSnapshot } from "@/lib/pm-paper-reader"

const MIN_BRIER_SAMPLE = 30

function fmtAge(sec: number | null): string {
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

function fmtPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—"
  const sign = n > 0 ? "+" : ""
  return `${sign}${(n * 100).toFixed(1)}%`
}

function fmtBrier(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—"
  return n.toFixed(3)
}

function Stat({ n, label }: { n: number | string | null; label: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-lg font-semibold tabular-nums text-zinc-100">{n ?? "—"}</span>
      <span className="text-[11px] text-zinc-500">{label}</span>
    </span>
  )
}

export function PmPaperCard() {
  const [data, setData] = useState<PmPaperSnapshot | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch("/api/pm-paper", { cache: "no-store" })
      const body = await res.json()
      if (!res.ok) setErr(body.error ?? "pm-paper 状态读取失败")
      else setData(body)
    } catch {
      setErr("pm-paper 状态读取失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const overall = data?.overall
  const sampleN = overall?.n_settled_predictions ?? 0
  const lowSample = sampleN < MIN_BRIER_SAMPLE
  const brierClaude = overall?.brier_claude ?? null
  const brierMarket = overall?.brier_market ?? null
  const claudeWins =
    brierClaude != null && brierMarket != null ? brierClaude < brierMarket : null

  return (
    <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LineChart className="h-4 w-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-200">pm-paper 模拟盘</span>
          <span className="text-xs text-zinc-500">Polymarket paper-trading</span>
        </div>
        <button onClick={load} aria-label="刷新" className="text-zinc-500 hover:text-zinc-300">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      {data?.halt && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          <CircleAlert className="h-3.5 w-3.5 shrink-0" />
          熔断中(HALT)— 回撤触发保护,executor 已停挂单
        </div>
      )}

      {err ? (
        <div className="mt-2 text-xs text-rose-400">{err}</div>
      ) : !data ? (
        <div className="mt-2 text-xs text-zinc-500">加载中…</div>
      ) : data.bootstrapping ? (
        <div className="mt-2 text-xs text-zinc-500">实验第0周,等待首轮数据</div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-2">
            <Stat n={data.universeCount} label="盘" />
            <Stat n={data.predictionsCount} label="累计预测" />
            <Stat n={overall?.n_open_orders ?? null} label="挂单中" />
            <Stat n={overall?.n_fills_total ?? null} label="已成交" />
            <Stat n={overall?.n_settled_predictions ?? null} label="已结算" />
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
              <div className="text-[11px] text-zinc-500">P&amp;L(bankroll ${data.bankroll ?? "—"})</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span
                  className={cn(
                    "text-base font-semibold tabular-nums",
                    (overall?.pnl ?? 0) > 0
                      ? "text-emerald-400"
                      : (overall?.pnl ?? 0) < 0
                        ? "text-rose-400"
                        : "text-zinc-300",
                  )}
                >
                  {fmtUsd(overall?.pnl)}
                </span>
                <span className="text-xs text-zinc-500">{fmtPct(overall?.roi_on_cost)} ROI</span>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
              <div className="text-[11px] text-zinc-500">
                Brier(Claude vs 市场,越低越准)
                {lowSample && <span className="ml-1.5 text-amber-500/80">样本不足({sampleN})</span>}
              </div>
              <div className="mt-1 flex items-baseline gap-3 text-xs">
                <span
                  className={cn(
                    "font-semibold tabular-nums",
                    claudeWins === true ? "text-emerald-400" : claudeWins === false ? "text-rose-400" : "text-zinc-300",
                  )}
                >
                  Claude {fmtBrier(brierClaude)}
                </span>
                <span
                  className={cn(
                    "font-semibold tabular-nums",
                    claudeWins === false ? "text-emerald-400" : claudeWins === true ? "text-rose-400" : "text-zinc-300",
                  )}
                >
                  市场 {fmtBrier(brierMarket)}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 text-xs">
            {(["politics", "data"] as const).map((key) => {
              const c = data.cohorts[key]
              return (
                <div key={key} className="flex items-center justify-between rounded-lg border border-zinc-800/60 px-2.5 py-1.5">
                  <span className="text-zinc-400">{key === "politics" ? "政治盘" : "数据盘"}</span>
                  <span className="text-zinc-300 tabular-nums">
                    {c ? `${c.n_settled_predictions} 结算 · ${fmtUsd(c.pnl)}` : "—"}
                  </span>
                </div>
              )
            })}
          </div>

          <div className="mt-3 text-[11px] text-zinc-600">
            数据更新:{data.generatedAt ? new Date(data.generatedAt).toLocaleString("zh-CN") : "—"}
            {data.ageSeconds != null && <span> · {fmtAge(data.ageSeconds)}</span>}
          </div>
        </>
      )}
    </section>
  )
}
