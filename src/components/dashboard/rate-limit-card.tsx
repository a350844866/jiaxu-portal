"use client"

import { useEffect, useState } from "react"
import { Gauge, Zap, Sparkles, Cpu, Bot, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

type Provider = "claude" | "codex"

interface ModelUsage {
  provider: Provider
  model: string
  output_today: number
  total_today: number
  cost_today: number
  output_weekly: number
  total_weekly: number
  cost_weekly: number
  threads_today: number
  threads_weekly: number
}

interface ProductGroup {
  provider: Provider
  models: ModelUsage[]
  cost_today: number
  cost_weekly: number
  total_today: number
  total_weekly: number
}

interface RateLimitData {
  as_of: string
  groups: ProductGroup[]
}

const MODEL_META: Record<string, { name: string; icon: typeof Zap; tone: string }> = {
  opus:       { name: "Opus",      icon: Sparkles, tone: "from-violet-500/15 to-violet-500/0 border-violet-500/25" },
  sonnet:     { name: "Sonnet",    icon: Zap,      tone: "from-blue-500/15 to-blue-500/0 border-blue-500/25" },
  haiku:      { name: "Haiku",     icon: Cpu,      tone: "from-teal-500/15 to-teal-500/0 border-teal-500/25" },
  "gpt-5.4":  { name: "GPT-5.4",  icon: Bot,      tone: "from-emerald-500/15 to-emerald-500/0 border-emerald-500/25" },
  "gpt-5.3":  { name: "GPT-5.3",  icon: Bot,      tone: "from-lime-500/15 to-lime-500/0 border-lime-500/25" },
  "gpt-4.1":  { name: "GPT-4.1",  icon: Bot,      tone: "from-green-500/15 to-green-500/0 border-green-500/25" },
  "o3":       { name: "o3",        icon: Bot,      tone: "from-cyan-500/15 to-cyan-500/0 border-cyan-500/25" },
  "o4-mini":  { name: "o4-mini",   icon: Bot,      tone: "from-sky-500/15 to-sky-500/0 border-sky-500/25" },
}

const PROVIDER_META: Record<Provider, { label: string; accent: string }> = {
  claude: { label: "Claude", accent: "text-violet-400" },
  codex:  { label: "Codex",  accent: "text-emerald-400" },
}

const DEFAULT_META = { name: "Unknown", icon: Bot, tone: "from-zinc-500/15 to-zinc-500/0 border-zinc-500/25" }

function fmtTokens(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B"
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M"
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K"
  return String(n)
}

function fmtCost(n: number): string {
  if (n >= 100) return "$" + n.toFixed(0)
  if (n >= 10) return "$" + n.toFixed(1)
  return "$" + n.toFixed(2)
}

function ProductSection({ group }: { group: ProductGroup }) {
  const [open, setOpen] = useState(true)
  const pmeta = PROVIDER_META[group.provider]
  const isClaude = group.provider === "claude"

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 hover:bg-zinc-800/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className={cn("text-sm font-semibold", pmeta.accent)}>{pmeta.label}</span>
          <div className="flex gap-3 text-xs text-zinc-500 tabular-nums">
            <span>今日 <span className="text-zinc-300">{fmtTokens(group.total_today)}</span>{" / "}<span className="text-zinc-300">{fmtCost(group.cost_today)}</span></span>
            <span>本周 <span className="text-zinc-300">{fmtTokens(group.total_weekly)}</span>{" / "}<span className="text-zinc-300">{fmtCost(group.cost_weekly)}</span></span>
          </div>
        </div>
        <ChevronDown className={cn("h-4 w-4 text-zinc-500 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="grid gap-3 p-3 pt-0 sm:grid-cols-2 lg:grid-cols-3">
          {group.models.map((m) => {
            const meta = MODEL_META[m.model] ?? { ...DEFAULT_META, name: m.model }
            const Icon = meta.icon
            const hasOutput = m.output_today > 0
            const hasActivity = hasOutput || m.total_today > 0

            return (
              <div
                key={m.model}
                className={cn(
                  "relative overflow-hidden rounded-xl border bg-gradient-to-br p-4",
                  meta.tone,
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
                      hasActivity ? "bg-emerald-400 animate-pulse" : "bg-zinc-600",
                    )}
                    title={hasActivity ? "今日有消耗" : "空闲"}
                  />
                </div>

                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-2xl font-semibold text-zinc-100 tabular-nums">
                    {hasOutput ? fmtTokens(m.output_today) : fmtTokens(m.total_today)}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {hasOutput ? "今日 output" : "今日 tokens"}
                  </span>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-y-1 text-xs tabular-nums">
                  <dt className="text-zinc-500">今日总 token</dt>
                  <dd className="text-right text-zinc-300">{fmtTokens(m.total_today)}</dd>
                  <dt className="text-zinc-500">今日费用</dt>
                  <dd className="text-right text-zinc-300">{fmtCost(m.cost_today)}</dd>
                  <dt className="text-zinc-500">周 output</dt>
                  <dd className="text-right text-zinc-300">{fmtTokens(m.output_weekly)}</dd>
                  <dt className="text-zinc-500">周费用</dt>
                  <dd className="text-right text-zinc-300">{fmtCost(m.cost_weekly)}</dd>
                  {m.threads_weekly > 0 && (
                    <>
                      <dt className="text-zinc-500">今日/周会话</dt>
                      <dd className="text-right text-zinc-300">{m.threads_today} / {m.threads_weekly}</dd>
                    </>
                  )}
                </dl>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function RateLimitCard() {
  const [data, setData] = useState<RateLimitData | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const r = await fetch("/api/token/rate-limits", { cache: "no-store" })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j = (await r.json()) as RateLimitData
        if (!cancelled) { setData(j); setErr(null) }
      } catch (e) {
        if (!cancelled) setErr(String(e))
      }
    }
    load()
    const id = setInterval(load, 30_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  if (err && !data) {
    return (
      <section className="mb-6">
        <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-3 text-xs text-red-300">
          额度数据不可用: {err}
        </div>
      </section>
    )
  }

  const totalCostWeekly = data?.groups.reduce((s, g) => s + g.cost_weekly, 0) ?? 0
  const totalCostToday = data?.groups.reduce((s, g) => s + g.cost_today, 0) ?? 0

  return (
    <section className="mb-6">
      <div className="mb-3 flex items-baseline justify-between">
        <div className="flex items-center gap-2 text-sm text-zinc-300">
          <Gauge className="h-4 w-4 text-zinc-500" />
          <span className="font-medium">AI 模型用量</span>
          <span className="text-xs text-zinc-600">北京时间今日 · 30s 轮询</span>
        </div>
        {data && (
          <div className="flex gap-4 text-xs text-zinc-500 tabular-nums">
            <span>今日合计 <span className="text-zinc-200">{fmtCost(totalCostToday)}</span></span>
            <span>本周合计 <span className="text-zinc-200">{fmtCost(totalCostWeekly)}</span></span>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {data?.groups.map((g) => (
          <ProductSection key={g.provider} group={g} />
        ))}
      </div>
    </section>
  )
}
