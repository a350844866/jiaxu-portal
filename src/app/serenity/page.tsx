import {
  readLedger, readTweets,
  tweetCountByDay, tickerMentionCounts, verdictBreakdown,
} from "@/lib/serenity-reader"
import { Act, Stat } from "@/components/dashboard/serenity/section"
import { TrustScorecard } from "@/components/dashboard/serenity/trust-scorecard"
import { HoldingsSection } from "@/components/dashboard/serenity/holdings-section"
import { CatalystTimeline } from "@/components/dashboard/serenity/catalyst-timeline"
import { TweetBrowser } from "@/components/dashboard/serenity/tweet-browser"
import { Sparkline, TickerHeatChart } from "@/components/dashboard/serenity/charts"
import { PANEL } from "@/components/dashboard/serenity/theme"

export const dynamic = "force-dynamic"

function freshness(sec: number): { text: string; stale: boolean } {
  const d = Math.floor(sec / 86400)
  if (d <= 0) return { text: "今日蒸馏", stale: false }
  if (d === 1) return { text: "1 天前蒸馏", stale: false }
  return { text: `${d} 天前蒸馏`, stale: d > 10 }
}

export default async function SerenityPage() {
  const [ledgerRes, tweetsRes] = await Promise.all([readLedger(), readTweets()])

  if (!ledgerRes.ok) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-6">
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-6 text-sm text-rose-300">
          读 ledger.json 失败:{ledgerRes.error}
        </div>
      </main>
    )
  }

  const ledger = ledgerRes.ledger
  const tweets = tweetsRes.ok ? tweetsRes.tweets : []
  const fresh = freshness(ledgerRes.ageSeconds)

  const days = tweetCountByDay(tweets).slice(-14)
  const heatCutoff = days[0]?.day ?? ""
  const recentTweets = tweets.filter((t) => t.timestamp.slice(0, 10) >= heatCutoff)
  const heat = tickerMentionCounts(recentTweets)
  const verdicts = verdictBreakdown(ledger.predictions)

  const active = ledger.positions.filter((p) => p.status === "active").length
  const newThisWeek = ledger.positions.filter((p) => p.stance === "新开").length

  return (
    <main className="relative min-h-screen space-y-8 bg-zinc-950 p-4 sm:p-6 lg:p-8">
      {/* 氛围光晕:暖琥珀(打假)+ 冷青(盯仓),营造深度 */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 left-[15%] h-96 w-96 rounded-full bg-amber-500/[0.05] blur-3xl" />
        <div className="absolute top-1/3 right-[12%] h-[28rem] w-[28rem] rounded-full bg-sky-500/[0.04] blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-96 w-96 rounded-full bg-violet-500/[0.03] blur-3xl" />
      </div>

      {/* ── Hero ── */}
      <header className="flex flex-wrap items-start justify-between gap-4 animate-in fade-in-0 slide-in-from-top-2 duration-700">
        <div className="flex items-center gap-3.5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500/80 to-violet-600/80 text-xl font-bold text-white shadow-lg shadow-sky-950/50">
            S
          </div>
          <div>
            <h1 className="flex items-baseline gap-2 text-xl font-bold tracking-tight text-zinc-50">
              Serenity
              <span className="font-mono text-xs font-normal text-zinc-500">@aleabitoreddit</span>
            </h1>
            <p className="mt-0.5 text-xs text-zinc-400">
              AI / 半导体供应链分析师 · 430K 粉 · 8000+ 付费订阅
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-[11px] text-zinc-400">
              蒸馏至 <span className="font-mono text-zinc-300">{ledger.updated}</span>
            </div>
            <div className="mt-0.5 flex items-center justify-end gap-2">
              <span className={`text-[10px] ${fresh.stale ? "text-amber-400" : "text-zinc-600"}`}>
                {fresh.stale && "⚠ "}{fresh.text}
              </span>
              <span className="text-[10px] text-zinc-600">·</span>
              <span className="text-[10px] tabular-nums text-zinc-500">
                {tweets.length} 推
                {!tweetsRes.ok && <span className="ml-1 text-rose-400">(读取失败)</span>}
              </span>
            </div>
          </div>
          <div className="hidden h-10 w-px bg-zinc-800 sm:block" />
          <div className="hidden flex-col items-end gap-1 sm:flex">
            <span className="text-[10px] text-zinc-600">活跃脉搏 · 近 14 活跃日</span>
            <Sparkline data={days} className="h-8" />
          </div>
        </div>
      </header>

      {/* ── 第①幕:他可信吗 ── */}
      <Act
        index="01"
        title="信任度记分卡"
        subtitle="先判可信度 · 自报战绩不可证伪 + 预测对账只用可核对部分计分"
        icon={<span>🛡</span>}
        accent="#fbbf24"
        delay={80}
      >
        <TrustScorecard ledger={ledger} verdicts={verdicts} />
      </Act>

      {/* ── 第②幕:他现在拿着什么 ── */}
      <Act
        index="02"
        title="盯仓 · 跟单线索"
        subtitle="按产业链分层:上游材料 → 中游器件 → 终端算力。点卡片看支撑原推"
        icon={<span>🎯</span>}
        accent="#34d399"
        delay={160}
      >
        <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-xs">
          <Stat value={active} label="活跃持仓" accent="#34d399" />
          <Stat value={newThisWeek} label="新开仓位" accent="#34d399" />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <HoldingsSection positions={ledger.positions} tweets={tweets} />
          </div>
          <aside className={`${PANEL} h-fit p-4`}>
            <h3 className="mb-1 text-[11px] font-medium text-zinc-300">提及热度</h3>
            <p className="mb-3 text-[10px] text-zinc-600">近 14 活跃日,印证注意力分配</p>
            <TickerHeatChart data={heat} />
          </aside>
        </div>
      </Act>

      {/* ── 第③幕:接下来盯什么 ── */}
      <Act
        index="03"
        title="前瞻 Catalyst"
        subtitle="什么时候可能有动作 · 最近的在最上"
        icon={<span>🗓</span>}
        accent="#38bdf8"
        delay={240}
      >
        <CatalystTimeline catalysts={ledger.catalysts} />
      </Act>

      {/* ── 第④幕:证据在哪 ── */}
      <Act
        index="04"
        title="溯源 · 推文"
        subtitle="全量语料可搜可筛,回到原始发言核对"
        icon={<span>🔍</span>}
        accent="#a1a1aa"
        delay={320}
      >
        <TweetBrowser tweets={tweets} />
      </Act>
    </main>
  )
}
