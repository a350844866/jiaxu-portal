import { PANEL, cohortChip, ruleFlagStyle, confidenceStyle } from "./theme"
import type { PredictionRow } from "@/lib/pm-paper-detail-pure"

function fmtP(n: number): string {
  return n.toFixed(2)
}

function divColor(d: number): string {
  if (Math.abs(d) < 0.08) return "text-zinc-400"
  return d > 0 ? "text-emerald-400" : "text-rose-400"
}

const TRIGGER_LABEL: Record<string, string> = {
  new: "新盘",
  "staleness-guard": "护栏重预测",
  "price-moved": "价格漂移",
  "near-resolution": "临近结算",
}

export function PredictionsTable({ rows }: { rows: PredictionRow[] }) {
  return (
    <div className={`${PANEL} overflow-x-auto p-4`}>
      <h3 className="mb-3 text-sm font-semibold text-zinc-200">
        预测 <span className="ml-1 text-xs font-normal text-zinc-500">{rows.length} 盘 · 每盘最新一条 · 按分歧幅度排序</span>
      </h3>
      <table className="w-full min-w-[860px] text-xs">
        <thead className="border-b border-zinc-800 text-zinc-500">
          <tr>
            <th className="px-3 py-2 text-left font-medium">market</th>
            <th className="px-3 py-2 text-right font-medium">p</th>
            <th className="px-3 py-2 text-right font-medium">mid@预测</th>
            <th className="px-3 py-2 text-right font-medium">divergence</th>
            <th className="px-3 py-2 text-left font-medium">confidence</th>
            <th className="px-3 py-2 text-left font-medium">trigger</th>
            <th className="px-3 py-2 text-left font-medium">reasoning</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center text-xs text-zinc-600">
                暂无预测 —— 等待 predictor 首轮跑
              </td>
            </tr>
          ) : (
            rows.map((p) => {
              const rf = ruleFlagStyle(p.rule_flag)
              const cf = confidenceStyle(p.confidence)
              return (
                <tr key={p.market_id} className="border-b border-zinc-800/60 align-top hover:bg-zinc-900/40">
                  <td className="px-3 py-2">
                    <div className="max-w-xs">
                      <div className="truncate text-zinc-200" title={p.question}>{p.question}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {p.cohort && (
                          <span className={`rounded border px-1.5 py-0 text-[10px] ${cohortChip(p.cohort)}`}>
                            {p.cohort === "politics" ? "政治" : p.cohort === "data" ? "数据" : p.cohort}
                          </span>
                        )}
                        <span className={`rounded border px-1.5 py-0 text-[10px] ${rf.badge}`}>{rf.label}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-200">{fmtP(p.p)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-400">{fmtP(p.mid_at_prediction)}</td>
                  <td className={`px-3 py-2 text-right font-semibold tabular-nums ${divColor(p.divergence)}`}>
                    {p.divergence > 0 ? "+" : ""}{p.divergence.toFixed(3)}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded border px-1.5 py-0 text-[10px] ${cf.chip}`}>{cf.label}</span>
                  </td>
                  <td className="px-3 py-2 text-zinc-500">{p.trigger ? (TRIGGER_LABEL[p.trigger] ?? p.trigger) : "—"}</td>
                  <td className="px-3 py-2 text-zinc-400">
                    <details>
                      <summary className="max-w-xs cursor-pointer truncate text-zinc-500 hover:text-zinc-300" title="点击展开完整推理">
                        {p.reasoning || "(无)"}
                      </summary>
                      <div className="mt-1 max-w-sm whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-400">
                        {p.reasoning}
                        {p.rules_notes && (
                          <div className="mt-1 text-zinc-500">
                            <span className="text-zinc-600">规则:</span> {p.rules_notes}
                          </div>
                        )}
                      </div>
                    </details>
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}
