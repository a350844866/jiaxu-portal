import Link from "next/link"
import { readTradeMaxSnapshot } from "@/lib/trademax-reader"
import {
  Vitals, EquityChart, MoneySource, RulesTable, StopPanel, DayTable,
  TimingPanel, RiskPanel, LiveFeed, AnomalyPanel, DealsTable, EntryPanel,
} from "@/components/dashboard/trademax/panels"
import { AutoRefresh } from "@/components/dashboard/trademax/auto-refresh"

export const dynamic = "force-dynamic"

export default async function TradeMaxPage() {
  const s = await readTradeMaxSnapshot()

  if (!s.ok) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-6">
        <div className="max-w-md rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-6 text-sm text-amber-200">
          {s.error}
          <div className="mt-2 text-xs text-zinc-500">
            检查家服 <code>systemctl status trademax-observer</code> 与 portal 的{" "}
            <code>/data/trademax-observer</code> 挂载。
          </div>
          <div className="mt-3">
            <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300">← 返回首页</Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="relative min-h-screen space-y-5 bg-zinc-950 p-4 sm:p-6 lg:p-8">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 left-[15%] h-96 w-96 rounded-full bg-amber-500/[0.06] blur-3xl" />
        <div className="absolute top-1/2 right-[8%] h-[28rem] w-[28rem] rounded-full bg-emerald-500/[0.03] blur-3xl" />
      </div>

      <header className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-xl font-bold text-zinc-50">黄金「量化」观摩号</h1>
          <span className="text-xs text-zinc-500">
            trademax-observer · 只读观察 + 策略反推
          </span>
          <AutoRefresh seconds={15} />
          <Link href="/" className="ml-auto text-xs text-zinc-500 hover:text-zinc-300">← 返回首页</Link>
        </div>
        <p className="max-w-4xl text-sm leading-6 text-zinc-400">
          别人给的 MT4 <span className="text-zinc-200">观摩（investor，只读）</span>账号，用来验证他那套
          「#MT4黄金一次一单」到底是什么。EA 本体看不到（它跑在对方终端上），所以这里做的是
          <span className="text-zinc-200">从订单行为反推规则</span>——并且把样本量和风险摆在和收益率同样显眼的位置。
        </p>
      </header>

      <Vitals account={s.account} perf={s.perf} equity={s.equity} watch={s.watch} openPositions={s.openPositions} />

      <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.05] px-4 py-3 text-[12px] leading-6 text-amber-100/90">
        <span className="font-semibold text-amber-200">先看这一段：</span>{" "}
        目前 {s.perf.n} 笔 / 约 {s.days.length} 个交易日，
        胜率 {s.perf.winRate != null ? (s.perf.winRate * 100).toFixed(1) : "—"}% 但盈亏比只有{" "}
        {s.perf.payoff?.toFixed(2) ?? "—"}——赢的多是几美元的保本位，亏的是一整笔止损。
        单笔名义杠杆 ≈ {s.risk.leverage?.toFixed(0) ?? "—"}×，单笔风险占本金{" "}
        {s.risk.riskPerTradePct != null ? (s.risk.riskPerTradePct * 100).toFixed(1) : "—"}%。
        <span className="text-amber-200">这个样本量证明不了任何边缘</span>，收益率高只说明它在这几天的行情里没踩坑。
      </div>

      <EquityChart equity={s.equity} />

      <div className="grid gap-5 lg:grid-cols-2">
        <MoneySource exits={s.exits} stops={s.stops} />
        <DayTable days={s.days} />
      </div>

      <RulesTable rules={s.rules} />

      <EntryPanel entry={s.entry} />

      <StopPanel stops={s.stops} />

      <div className="grid gap-5 lg:grid-cols-2">
        <TimingPanel timing={s.timing} concurrency={s.concurrency} />
        <RiskPanel risk={s.risk} perf={s.perf} equity={s.equity} />
      </div>

      <LiveFeed live={s.live} openPositions={s.openPositions} />

      <AnomalyPanel pending={s.pending} />

      <DealsTable deals={s.deals} lockLevel={s.stops.lockLevel} />

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-[11px] leading-6 text-zinc-500 sm:p-5">
        <h2 className="mb-2 text-sm font-semibold text-zinc-200">还没做到的部分</h2>
        <ul className="list-inside list-disc space-y-1">
          <li>
            <span className="text-zinc-300">入场只反推到「族」，没到具体指标</span>：确定是趋势延续类
            （见上面的入场触发反推），但动量特征彼此高度相关，说不出它到底用的哪根均线/哪个指标；
            而且方向闸不够选择性，还有一层择时逻辑没看到。
          </li>
          <li><span className="text-zinc-300">EA 本体不可见</span>——原理性的，不是权限问题。</li>
          <li>移损与撤 TP 的<span className="text-zinc-300">触发阈值</span>还没坐实，靠上面的实时会话流慢慢攒。</li>
          <li>没有主号（入金来源账户）的任何权限，「是不是跟单」停在推断。</li>
        </ul>
      </section>

      <footer className="pb-4 text-center text-[11px] text-zinc-600">
        数据：家服 /data/trademax-observer（systemd <code>trademax-observer.service</code> 常驻登录 MQL5 WebTerminal，10s 轮询）
        · 只读观摩，不涉任何下单 · 仅研究记录，非投资建议
      </footer>
    </main>
  )
}
