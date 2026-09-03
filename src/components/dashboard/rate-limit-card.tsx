"use client"

import { useEffect, useState } from "react"
import { Gauge, Zap, Sparkles, Cpu, Bot, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  ageWithDrift,
  fmtCountdown,
  fmtResetClock,
  isRolledOver,
  limitLabel,
  limitUsd,
  sortLimits,
  QUOTA_STALE_MS,
  type ClaudeQuota,
  type QuotaLimit,
} from "@/lib/claude-quota-pure"

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
  /** Max 官方配额帧(宿主 5min 采样); 缺失/陈旧由 ok/stale 如实带出 */
  claude_quota?: ClaudeQuota
}

const MODEL_META: Record<string, { name: string; icon: typeof Zap; tone: string }> = {
  fable:      { name: "Fable",     icon: Sparkles, tone: "from-amber-500/15 to-amber-500/0 border-amber-500/25" },
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

function ageLabel(s: number): string {
  if (s < 60) return "刚刚"
  const m = Math.round(s / 60)
  if (m < 60) return `${m} 分钟前`
  return `${(s / 3600).toFixed(1)} 小时前`
}

function utilizationTone(u: number | null): string {
  if (u === null) return "bg-zinc-600"
  if (u >= 90) return "bg-red-500"
  if (u >= 70) return "bg-amber-500"
  return "bg-violet-500"
}

function QuotaBar({ limit, quota, now }: { limit: QuotaLimit; quota: Extract<ClaudeQuota, { ok: true }>; now: number }) {
  const label = limitLabel(limit)
  // 帧最多 5 分钟旧: 窗口已翻转而下一帧未到, 帧里的 % 是上一窗口的, 不能画成当前
  const rolled = isRolledOver(limit.resets_at, now)
  const u = rolled ? null : limit.percent
  const { usd, by_model } = limitUsd(limit, quota)
  const usdTitle = Object.entries(by_model)
    .sort((a, b) => b[1] - a[1])
    .map(([m, v]) => `${m.replace(/^claude-/, "")} ${fmtCost(v)}`)
    .join(" · ")
  const weekly = limit.group === "weekly" || limit.kind.startsWith("weekly")
  return (
    <div className="flex items-center gap-2 text-xs sm:gap-3">
      <span className={cn("w-24 flex-shrink-0 truncate", limit.is_active ? "text-zinc-200" : "text-zinc-400")} title={`官方 kind=${limit.kind}${limit.is_active ? " · 当前生效" : ""}`}>
        {label}
      </span>
      <div
        className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-800"
        role="progressbar"
        aria-label={`${label} 官方配额已用`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={u ?? undefined}
        aria-valuetext={u === null ? "未知" : `${u}%`}
      >
        <div className={cn("h-full rounded-full", utilizationTone(u))} style={{ width: `${u ?? 0}%` }} />
      </div>
      <span className="w-10 flex-shrink-0 text-right font-mono tabular-nums text-zinc-100">
        {u === null ? "—" : `${u}%`}
      </span>
      <span
        className="flex-shrink-0 whitespace-nowrap text-right tabular-nums text-zinc-500"
        title={limit.resets_at ? `官方 resets_at(UTC): ${limit.resets_at}` : undefined}
      >
        {rolled ? (
          <>已重置<span className="text-zinc-600"> · 等下次采样</span></>
        ) : (
          <>
            重置 {fmtCountdown(limit.resets_at, now)}
            {limit.resets_at && <span className="hidden text-zinc-600 sm:inline"> · {fmtResetClock(limit.resets_at, weekly)}</span>}
          </>
        )}
      </span>
      <span
        className="hidden w-24 flex-shrink-0 whitespace-nowrap text-right font-mono tabular-nums text-zinc-500 sm:inline"
        title={
          quota.db_error
            ? `采样器查 MySQL 失败: ${quota.db_error}`
            : usdTitle
              ? `同窗口内按 API 标价折算: ${usdTitle}`
              : "同窗口内按 API 标价折算"
        }
      >
        {usd === null ? (quota.db_error ? "折算 —" : "") : `折算 ${fmtCost(usd)}`}
      </span>
    </div>
  )
}

/**
 * Max 官方配额(与 Claude Code /usage 同源). 与下面各模型 tile 的 $ 是两套口径:
 * tile 的 $ = API 标价折算(Fable 5.1 cache read $0.25 会显得"没用多少"), 这里才是订阅真正扣的.
 * 故意放在折叠区外面 —— 折叠 tile 也要一眼看到配额.
 */
function OfficialQuota({ quota, now, fetchedAt }: { quota: ClaudeQuota | undefined; now: number; fetchedAt: number }) {
  if (!quota || now === 0 || fetchedAt === 0) return null
  if (!quota.ok) {
    return (
      <div className="border-t border-zinc-800/60 px-4 py-2 text-xs text-amber-400">
        Max 官方配额不可用: {quota.error}
        {quota.age_seconds !== null && (
          <span className="text-zinc-600">（采样 {ageLabel(ageWithDrift(quota.age_seconds, fetchedAt, now))}）</span>
        )}
      </div>
    )
  }
  // 服务端算的 age 冻在最后一次成功拉取; 这里按本机时钟继续走, 轮询断了也不会一直显示"刚刚"
  const age = ageWithDrift(quota.age_seconds, fetchedAt, now)
  const stale = quota.stale || age * 1000 > QUOTA_STALE_MS
  return (
    <div className="border-t border-zinc-800/60 px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <span className="min-w-0 truncate text-zinc-400">
          Max 官方配额 <span className="text-zinc-600">· 与 /usage 同源 · 5min 采样 · 「折算 $」= 同窗 API 标价折算</span>
        </span>
        <span className={cn("flex-shrink-0", stale ? "text-amber-400" : "text-zinc-600")} title={`采样帧 ts(UTC): ${quota.sampled_at}`}>
          采样 {ageLabel(age)}
          {stale && " · 已陈旧"}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {sortLimits(quota.limits).map((l) => (
          <QuotaBar key={`${l.kind}:${l.scope_model ?? ""}`} limit={l} quota={quota} now={now} />
        ))}
      </div>
    </div>
  )
}

function ProductSection({ group, quota, now, fetchedAt }: { group: ProductGroup; quota?: ClaudeQuota; now: number; fetchedAt: number }) {
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

      {isClaude && <OfficialQuota quota={quota} now={now} fetchedAt={fetchedAt} />}

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
  // 最近一次成功拉取的时刻 + 本机时钟(10s 一跳), 供官方配额倒计时/采样年龄用;
  // 都不能在渲染里 Date.now()(react-hooks/purity), 所以走 state
  const [fetchedAt, setFetchedAt] = useState(0)
  const [now, setNow] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const r = await fetch("/api/token/rate-limits", { cache: "no-store" })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j = (await r.json()) as RateLimitData
        if (!cancelled) {
          const t = Date.now()
          setData(j); setErr(null); setFetchedAt(t); setNow(t)
        }
      } catch (e) {
        if (!cancelled) setErr(String(e))
      }
    }
    load()
    const id = setInterval(load, 30_000)
    const tick = setInterval(() => { if (!cancelled) setNow(Date.now()) }, 10_000)
    return () => { cancelled = true; clearInterval(id); clearInterval(tick) }
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
          <span className="text-xs text-zinc-600">北京时间今日 · 30s 轮询 · $ 为 API 标价折算，非订阅扣费</span>
          {err && data && (
            <span className="text-xs text-amber-400" title={err}>轮询失败 · 显示最后一次成功数据</span>
          )}
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
          <ProductSection
            key={g.provider}
            group={g}
            quota={g.provider === "claude" ? data?.claude_quota : undefined}
            now={now}
            fetchedAt={fetchedAt}
          />
        ))}
      </div>
    </section>
  )
}
