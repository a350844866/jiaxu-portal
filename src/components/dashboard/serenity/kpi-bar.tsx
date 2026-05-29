import type { Ledger } from "@/lib/serenity-reader"
import { TriangleAlert } from "lucide-react"

export function KpiBar({ ledger, tweetTotal }: { ledger: Ledger; tweetTotal: number }) {
  const active = ledger.positions.filter((p) => p.status === "active").length
  const newThisWeek = ledger.positions.filter((p) => p.stance === "新开").length
  const pending = ledger.predictions.filter((p) => p.verdict === "待核").length
  const cards = [
    { label: "活跃持仓", value: String(active) },
    { label: "本周新开", value: String(newThisWeek) },
    { label: "待核预测", value: String(pending) },
    { label: "推文总数", value: String(tweetTotal) },
  ]
  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <div className="text-xs text-zinc-500">{c.label}</div>
          <div className="mt-1 text-2xl font-semibold text-zinc-100">{c.value}</div>
        </div>
      ))}
      <div className="col-span-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 sm:col-span-4">
        <div className="flex items-center gap-2 text-xs text-amber-300">
          <TriangleAlert className="h-3.5 w-3.5" />
          自报 YTD {ledger.self_reported.ytd_pct}% / 2 年 {ledger.self_reported.two_year_pct}%
          <span className="rounded border border-amber-500/40 px-1">🚫 不可证伪</span>
          <span className="text-amber-400/70">截至 {ledger.self_reported.as_of}·IBKR 子账户口径非审计净值</span>
        </div>
      </div>
    </section>
  )
}
