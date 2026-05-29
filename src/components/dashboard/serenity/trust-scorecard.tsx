import type { Ledger, Verdict } from "@/lib/serenity-pure"
import { TriangleAlert } from "lucide-react"
import { DonutChart } from "./charts"
import { VERDICT, PANEL } from "./theme"

// 第①幕:他可信吗。两块——左:自报战绩(明确标 🚫 不可证伪);右:预测对账。
// 命中率只用"可证伪"的部分(兑现/落空)做分母,待核/不可证伪/归因不稳 排除在外,
// 分母透明就是打假逻辑本身。
export function TrustScorecard({
  ledger,
  verdicts,
}: {
  ledger: Ledger
  verdicts: { verdict: Verdict; count: number }[]
}) {
  const count = (v: Verdict) => verdicts.find((x) => x.verdict === v)?.count ?? 0
  const hit = count("兑现")
  const miss = count("落空")
  const checkable = hit + miss
  const hitRate = checkable > 0 ? Math.round((hit / checkable) * 100) : null
  const excluded = verdicts.reduce((s, d) => s + d.count, 0) - checkable
  const sr = ledger.self_reported

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {/* 自报战绩 — 警示色,强调不可独立审计 */}
      <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/[0.08] to-transparent p-4 backdrop-blur-sm">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-300/90">
          <TriangleAlert className="h-3.5 w-3.5" />
          自报战绩 · 不可独立审计
          <span className="ml-auto rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
            🚫 不可证伪
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-amber-500/60">YTD</div>
            <div className="font-mono text-2xl font-semibold tabular-nums text-amber-200">
              {sr.ytd_pct.toLocaleString()}%
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-amber-500/60">2 年回报</div>
            <div className="font-mono text-2xl font-semibold tabular-nums text-amber-200">
              {sr.two_year_pct.toLocaleString()}%
            </div>
          </div>
        </div>
        <p className="mt-3 text-[10px] leading-relaxed text-zinc-500">
          IBKR 子账户平台口径,非审计净值;LEAPs 杠杆放大,真 alpha 占比远低于表面。截至 {sr.as_of}。
        </p>
      </div>

      {/* 预测对账 — 命中率只算可证伪部分 */}
      <div className={`${PANEL} p-4`}>
        <div className="text-[11px] font-medium text-zinc-400">预测对账 · 可证伪部分计分</div>
        <div className="mt-3 flex items-center gap-4">
          <DonutChart data={verdicts} size={116} />
          <div className="min-w-0 flex-1">
            {hitRate !== null ? (
              <>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-semibold tabular-nums text-emerald-300">{hitRate}%</span>
                  <span className="text-[11px] text-zinc-500">命中率</span>
                </div>
                <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-zinc-800">
                  <div className="bg-emerald-500/70" style={{ width: `${(hit / checkable) * 100}%` }} />
                  <div className="bg-red-500/60" style={{ width: `${(miss / checkable) * 100}%` }} />
                </div>
                <div className="mt-1 text-[10px] text-zinc-500">
                  仅计可证伪的兑现/落空 {checkable} 条(✅{hit} / ❌{miss})
                  {excluded > 0 && `;另 ${excluded} 条待核/不可证伪/归因不稳不计入分母`}
                </div>
              </>
            ) : (
              <div className="text-[11px] text-zinc-500">暂无可证伪的兑现/落空记录</div>
            )}
          </div>
        </div>
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {verdicts.map((d) => {
            const vs = VERDICT[d.verdict] ?? VERDICT.待核
            return (
              <li
                key={d.verdict}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${vs.chip}`}
              >
                {vs.icon} {d.verdict}
                <span className="tabular-nums opacity-70">{d.count}</span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
