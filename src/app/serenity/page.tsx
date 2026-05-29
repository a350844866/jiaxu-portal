import {
  readLedger, readTweets,
  tweetCountByDay, tickerMentionCounts, verdictBreakdown,
  type Ledger,
} from "@/lib/serenity-reader"
import { KpiBar } from "@/components/dashboard/serenity/kpi-bar"
import { HoldingsSection } from "@/components/dashboard/serenity/holdings-section"
import { PostVolumeChart, TickerHeatChart, VerdictDonut } from "@/components/dashboard/serenity/charts"
import { TweetBrowser } from "@/components/dashboard/serenity/tweet-browser"

export const dynamic = "force-dynamic"

export default async function SerenityPage() {
  const [ledgerRes, tweetsRes] = await Promise.all([readLedger(), readTweets()])

  if (!ledgerRes.ok) {
    return (
      <main className="min-h-screen bg-zinc-950 p-6 text-sm text-rose-400">
        读 ledger.json 失败:{ledgerRes.error}
      </main>
    )
  }
  const ledger = ledgerRes.ledger
  const tweets = tweetsRes.ok ? tweetsRes.tweets : []

  // Recent window for charts (last 14 days of activity)
  const days = tweetCountByDay(tweets).slice(-14)
  const recentTweets = tweets.filter((t) => {
    const cutoff = ledger.last_distilled_ts.slice(0, 10)
    return t.timestamp.slice(0, 10) >= "2026-05-15" || cutoff === ""
  })
  const heat = tickerMentionCounts(recentTweets)
  const verdicts = verdictBreakdown(ledger.predictions)

  return (
    <main className="min-h-screen space-y-6 bg-zinc-950 p-4 sm:p-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold text-zinc-100">Serenity 盯仓台</h1>
        <span className="text-xs text-zinc-500">
          @aleabitoreddit · 蒸馏至 {ledger.updated} · 推文 {tweets.length}
          {!tweetsRes.ok && <span className="ml-2 text-rose-400">(corpus 读取失败)</span>}
        </span>
      </header>

      <KpiBar ledger={ledger} tweetTotal={tweets.length} />

      <HoldingsSection positions={ledger.positions} tweets={tweets} />

      <section className="grid gap-3 lg:grid-cols-3">
        <PostVolumeChart data={days} />
        <TickerHeatChart data={heat} />
        <VerdictDonut data={verdicts} />
      </section>

      <CatalystList ledger={ledger} />

      <TweetBrowser tweets={tweets} />
    </main>
  )
}

function CatalystList({ ledger }: { ledger: Ledger }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <h3 className="mb-3 text-xs font-medium text-zinc-400">前瞻 Catalyst 日历</h3>
      <ul className="space-y-1.5 text-xs">
        {ledger.catalysts.map((c, i) => (
          <li key={i} className="flex gap-3">
            <span className="w-24 flex-shrink-0 font-mono text-zinc-400">{c.date}</span>
            <span className="text-zinc-200">{c.event}</span>
            <span className="ml-auto text-zinc-500">{c.chain}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
