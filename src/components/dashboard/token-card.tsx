"use client"

import { useEffect, useState } from "react"
import { Activity, Bot, FileText, Laptop, LineChart, MessageSquare, TrendingUp } from "lucide-react"
import { cn } from "@/lib/utils"

type SystemName = "mt4" | "ibkr" | "quant-flow" | "auto-content" | "interactive" | "other" | "mbp"

interface SystemSummary {
  system: SystemName
  today_input: number
  today_output: number
  today_cache_read: number
  today_cache_create: number
  today_cost_usd: number
  today_total_tokens: number
  month_cost_usd: number
  last1h_cost_usd: number
  last1h_total_tokens: number
  last_event_ts: string | null
}

interface UsageLive {
  as_of: string
  systems: SystemSummary[]
  totals: {
    today_cost_usd: number
    today_total_tokens: number
    month_cost_usd: number
    last1h_total_tokens: number
  }
  zhanzhi: {
    today_cost_usd: number
    mine_cost: number
    pct_of_total: number | null
    pct_mine_of_total: number | null
  }
}

const LABELS: Record<SystemName, { name: string; icon: typeof Bot; tone: string }> = {
  mt4:            { name: "MT4 LLM",        icon: LineChart,     tone: "from-amber-500/15 to-amber-500/0 border-amber-500/25"   },
  ibkr:           { name: "IBKR 三阶段",     icon: Bot,           tone: "from-sky-500/15 to-sky-500/0 border-sky-500/25"         },
  "quant-flow":   { name: "quant-flow",     icon: TrendingUp,    tone: "from-violet-500/15 to-violet-500/0 border-violet-500/25" },
  "auto-content": { name: "auto-content",   icon: FileText,      tone: "from-orange-500/15 to-orange-500/0 border-orange-500/25" },
  interactive:    { name: "Interactive",    icon: MessageSquare, tone: "from-emerald-500/15 to-emerald-500/0 border-emerald-500/25" },
  mbp:            { name: "MBP (公司)",     icon: Laptop,        tone: "from-rose-500/15 to-rose-500/0 border-rose-500/25"      },
  other:          { name: "其他",            icon: Activity,      tone: "from-zinc-500/15 to-zinc-500/0 border-zinc-500/25"     },
}

// mt4 / ibkr 已停运下线 (2026-06-09),从消耗卡移除其 tile;如恢复交易把 "mt4"/"ibkr" 加回即可
const VISIBLE: SystemName[] = ["quant-flow", "auto-content", "interactive", "mbp"]

function fmtTokens(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B"
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M"
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K"
  return String(n)
}

function fmtCost(n: number): string {
  if (n >= 100) return "$" + n.toFixed(0)
  if (n >= 10)  return "$" + n.toFixed(1)
  return "$" + n.toFixed(2)
}

function freshness(iso: string | null): { text: string; stale: boolean } {
  if (!iso) return { text: "—", stale: true }
  const ageMs = Date.now() - new Date(iso).getTime()
  const ageMin = ageMs / 60_000
  if (ageMin < 1)  return { text: "<1m", stale: false }
  if (ageMin < 60) return { text: `${Math.floor(ageMin)}m 前`, stale: ageMin > 30 }
  const ageH = ageMin / 60
  if (ageH < 24)   return { text: `${ageH.toFixed(1)}h 前`, stale: true }
  return { text: `${Math.floor(ageH / 24)}d 前`, stale: true }
}

export function TokenCard() {
  const [data, setData] = useState<UsageLive | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const r = await fetch("/api/token/live", { cache: "no-store" })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j = (await r.json()) as UsageLive
        if (!cancelled) {
          setData(j)
          setErr(null)
        }
      } catch (e) {
        if (!cancelled) setErr(String(e))
      }
    }
    load()
    const id = setInterval(load, 10_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  if (err && !data) {
    return (
      <section className="mb-6">
        <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-3 text-xs text-red-300">
          Token usage 数据不可用: {err}
        </div>
      </section>
    )
  }

  return (
    <section className="mb-6">
      <div className="mb-3 flex items-baseline justify-between">
        <div className="flex items-center gap-2 text-sm text-zinc-300">
          <Activity className="h-4 w-4 text-zinc-500" />
          <span className="font-medium">LLM Token 实时消耗</span>
          <span className="text-xs text-zinc-600">按业务系统分桶 · 北京时间今日 · 10s 轮询 (quant-flow 含 Codex)</span>
        </div>
        {data && (
          <div className="flex gap-4 text-xs text-zinc-500 tabular-nums">
            <span>今日合计 <span className="text-zinc-200">{fmtCost(data.totals.today_cost_usd)}</span></span>
            {data.zhanzhi && (
              <span>
                Claude 池 我 <span className="text-zinc-200">{fmtCost(data.zhanzhi.mine_cost)}</span>
                {data.zhanzhi.pct_mine_of_total != null ? <span className="text-zinc-600"> ({data.zhanzhi.pct_mine_of_total}%)</span> : null}
                {" · 展志 "}<span className="text-zinc-200">{fmtCost(data.zhanzhi.today_cost_usd)}</span>
                {data.zhanzhi.pct_of_total != null ? <span className="text-zinc-600"> ({data.zhanzhi.pct_of_total}%)</span> : null}
              </span>
            )}
            <span>本月 <span className="text-zinc-200">{fmtCost(data.totals.month_cost_usd)}</span></span>
            <span>最近 1h <span className="text-zinc-200">{fmtTokens(data.totals.last1h_total_tokens)}</span></span>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {VISIBLE.map((s) => {
          const row = data?.systems.find((x) => x.system === s)
          const meta = LABELS[s]
          const Icon = meta.icon
          const fresh = freshness(row?.last_event_ts ?? null)
          const rateActive = (row?.last1h_total_tokens ?? 0) > 0
          return (
            <div
              key={s}
              className={cn(
                "relative overflow-hidden rounded-xl border bg-gradient-to-br p-4",
                meta.tone
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-zinc-300" />
                  <span className="text-sm font-medium text-zinc-200">{meta.name}</span>
                </div>
                <span
                  className={cn(
                    "inline-flex h-2 w-2 rounded-full",
                    rateActive ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"
                  )}
                  title={rateActive ? "最近 1h 有活动" : "空闲"}
                />
              </div>

              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-2xl font-semibold text-zinc-100 tabular-nums">
                  {row ? fmtCost(row.today_cost_usd) : "—"}
                </span>
                <span className="text-xs text-zinc-500">今日</span>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-y-1 text-xs tabular-nums">
                <dt className="text-zinc-500">今日 token</dt>
                <dd className="text-right text-zinc-300">
                  {row ? fmtTokens(row.today_total_tokens) : "—"}
                </dd>
                <dt className="text-zinc-500">本月 $</dt>
                <dd className="text-right text-zinc-300">
                  {row ? fmtCost(row.month_cost_usd) : "—"}
                </dd>
                <dt className="text-zinc-500">最近 1h</dt>
                <dd className="text-right text-zinc-300">
                  {row ? fmtTokens(row.last1h_total_tokens) : "—"}
                </dd>
                <dt className="text-zinc-500">最近事件</dt>
                <dd
                  className={cn(
                    "text-right",
                    fresh.stale ? "text-zinc-500" : "text-zinc-300"
                  )}
                >
                  {fresh.text}
                </dd>
              </dl>
            </div>
          )
        })}
      </div>
    </section>
  )
}
