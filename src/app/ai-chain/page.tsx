import { readChain, readQuotes } from "@/lib/ai-chain-reader"
import { readLedger } from "@/lib/serenity-reader"
import { SegmentSection, type StockView } from "@/components/dashboard/ai-chain/segment-section"
import { CP, PANEL } from "@/components/dashboard/ai-chain/theme"

export const dynamic = "force-dynamic"

function ageText(sec: number): string {
  const h = Math.floor(sec / 3600)
  if (h < 1) return "刚更新"
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

export default async function AiChainPage() {
  const [chainRes, quotesRes, ledgerRes] = await Promise.all([readChain(), readQuotes(), readLedger()])

  if (!chainRes.ok) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-6">
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-6 text-sm text-rose-300">
          读 ai-chain.json 失败:{chainRes.error}
          <p className="mt-2 text-xs text-rose-400/70">
            权威源在 vault wiki/concepts/,检查 Nextcloud 同步与 VAULT_DIR 挂载。
          </p>
        </div>
      </main>
    )
  }

  const chain = chainRes.chain
  const quotes = quotesRes.ok ? quotesRes.quotes.quotes : {}
  // 白毛女活账本 overlay:active 持仓 ticker → stance(ledger 挂了就叠加,挂不上静默降级)
  const serenityMap = new Map<string, string>()
  if (ledgerRes.ok) {
    for (const p of ledgerRes.ledger.positions) {
      if (p.status === "active") serenityMap.set(p.ticker.replace(/^\$/, "").toUpperCase(), p.stance)
    }
  }

  const bySegment = new Map<string, StockView[]>()
  for (const s of chain.stocks) {
    const seg = chain.segments.find((x) => x.id === s.segment)
    const list = bySegment.get(s.segment) ?? []
    list.push({
      stock: s,
      quote: quotes[s.ticker] ?? null,
      serenityStance: serenityMap.get(s.ticker) ?? null,
      focus: seg?.focus.includes(s.ticker) ?? false,
    })
    bySegment.set(s.segment, list)
  }

  const holdings = chain.stocks.filter((s) => s.holding).length
  const signals = chain.stocks.reduce((n, s) => n + s.signals.length, 0)
  const cpYes = chain.stocks.filter((s) => s.cp === "yes").length

  return (
    <main className="relative min-h-screen space-y-6 bg-zinc-950 p-4 sm:p-6 lg:p-8">
      {/* 氛围光晕:琥珀(chokepoint)+ 青(行情),与 serenity 看板同语言 */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 left-[20%] h-96 w-96 rounded-full bg-amber-500/[0.05] blur-3xl" />
        <div className="absolute top-1/2 right-[10%] h-[28rem] w-[28rem] rounded-full bg-emerald-500/[0.03] blur-3xl" />
      </div>

      {/* 头部 */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-xl font-bold text-zinc-50">AI 全产业链</h1>
          <span className="text-xs text-zinc-500">
            地图 {chain.updated} · 行情{" "}
            {quotesRes.ok ? ageText(quotesRes.ageSeconds) : "未就绪(等首次 cron)"}
            {" · "}权威源 vault [[AI全产业链地图]]
          </span>
        </div>
        <p className="max-w-5xl text-sm leading-6 text-zinc-300">{chain.stage}</p>
        <div className="flex flex-wrap gap-2 text-[11px]">
          <span className="rounded-full border border-zinc-700/60 bg-zinc-800/40 px-2.5 py-0.5 text-zinc-300">
            {chain.segments.length} 环节 · {chain.stocks.length} 标的
          </span>
          <span className={`rounded-full border px-2.5 py-0.5 ${CP.yes.badge}`}>chokepoint ×{cpYes}</span>
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/12 px-2.5 py-0.5 text-emerald-300">
            Taieo 持仓 ×{holdings}
          </span>
          <span className="rounded-full border border-violet-500/30 bg-violet-500/12 px-2.5 py-0.5 text-violet-300">
            白毛 overlay ×{serenityMap.size}
          </span>
          <span className="rounded-full border border-amber-500/30 bg-amber-500/12 px-2.5 py-0.5 text-amber-300">
            信号 ×{signals}
          </span>
        </div>
      </header>

      {/* 三大争论 */}
      <section className="grid gap-3 md:grid-cols-3">
        {chain.debates.map((d) => (
          <div key={d.topic} className={`${PANEL} p-4`}>
            <h3 className="mb-2 text-sm font-semibold text-zinc-200">{d.topic}</h3>
            <p className="text-[11px] leading-4 text-red-300/80">
              <span className="mr-1 font-semibold">空</span>
              {d.bear}
            </p>
            <p className="mt-1.5 text-[11px] leading-4 text-emerald-300/80">
              <span className="mr-1 font-semibold">多</span>
              {d.bull}
            </p>
          </div>
        ))}
      </section>

      {/* 11 环节 */}
      {chain.segments.map((seg, i) => (
        <SegmentSection key={seg.id} segment={seg} views={bySegment.get(seg.id) ?? []} index={i + 1} />
      ))}

      <footer className="pb-4 text-center text-[11px] text-zinc-600">
        数据:vault ai-chain.json(Claude 随 [[AI全产业链地图]] 联动维护)+ yfinance 日更收盘行情 ·
        标记来源 Alan / 白毛女(Serenity)/ Taieo / Claude · 仅研究优先级,非投资建议
      </footer>
    </main>
  )
}
