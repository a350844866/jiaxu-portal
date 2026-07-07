import { PANEL, cohortChip, pnlColor, brierWinner } from "./theme"
import type { SettlementRow } from "@/lib/pm-paper-detail-pure"

function fmtTime(ts: number): string {
  if (!ts) return "—"
  return new Date(ts * 1000).toLocaleString("zh-CN", { hour12: false })
}

export function SettlementsTable({ rows }: { rows: SettlementRow[] }) {
  return (
    <div className={`${PANEL} overflow-x-auto p-4`}>
      <h3 className="mb-3 text-sm font-semibold text-zinc-200">
        结算记录 <span className="ml-1 text-xs font-normal text-zinc-500">{rows.length} 条(settlements.jsonl)</span>
      </h3>
      <table className="w-full min-w-[760px] text-xs">
        <thead className="border-b border-zinc-800 text-zinc-500">
          <tr>
            <th className="px-3 py-2 text-left font-medium">market</th>
            <th className="px-3 py-2 text-right font-medium">p</th>
            <th className="px-3 py-2 text-center font-medium">outcome</th>
            <th className="px-3 py-2 text-center font-medium">成交?</th>
            <th className="px-3 py-2 text-right font-medium">pnl</th>
            <th className="px-3 py-2 text-right font-medium">brier(claude/市场)</th>
            <th className="px-3 py-2 text-left font-medium">结算时间</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center text-xs text-zinc-600">
                等待数据积累 —— 暂无已结算记录(30-60 天结算周期,首批预测刚开始)
              </td>
            </tr>
          ) : (
            rows.map((s) => {
              const winner = brierWinner(s.brier_claude, s.brier_market)
              return (
                <tr key={s.market_id} className="border-b border-zinc-800/60 hover:bg-zinc-900/40">
                  <td className="px-3 py-2">
                    <div className="max-w-xs">
                      <div className="truncate text-zinc-200" title={s.question}>{s.question}</div>
                      {s.cohort && (
                        <span className={`mt-1 inline-block rounded border px-1.5 py-0 text-[10px] ${cohortChip(s.cohort)}`}>
                          {s.cohort === "politics" ? "政治" : s.cohort === "data" ? "数据" : s.cohort}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-300">{s.p.toFixed(2)}</td>
                  <td className="px-3 py-2 text-center tabular-nums text-zinc-300">{s.outcome}</td>
                  <td className="px-3 py-2 text-center">
                    {s.filled ? (
                      <span className="text-emerald-400">✓</span>
                    ) : (
                      <span className="text-zinc-600">未成交</span>
                    )}
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold tabular-nums ${pnlColor(s.filled ? s.pnl : null)}`}>
                    {s.filled ? `${s.pnl > 0 ? "+" : ""}$${s.pnl.toFixed(2)}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <span className={winner === true ? "text-emerald-400" : "text-zinc-400"}>{s.brier_claude.toFixed(3)}</span>
                    <span className="mx-1 text-zinc-700">/</span>
                    <span className={winner === false ? "text-emerald-400" : "text-zinc-400"}>{s.brier_market.toFixed(3)}</span>
                  </td>
                  <td className="px-3 py-2 text-zinc-500">{fmtTime(s.resolve_ts)}</td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}
