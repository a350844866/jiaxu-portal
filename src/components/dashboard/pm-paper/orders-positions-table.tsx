import { PANEL, cohortChip, sideColor, ruleFlagStyle } from "./theme"
import type { OpenOrderRow, PositionRow } from "@/lib/pm-paper-detail-pure"

function fmtTime(ts: number): string {
  if (!ts) return "—"
  return new Date(ts * 1000).toLocaleString("zh-CN", { hour12: false })
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-6 text-center text-xs text-zinc-600">
        {text}
      </td>
    </tr>
  )
}

function QuestionCell({ question, cohort, ruleFlag }: { question: string; cohort: string | null; ruleFlag: string | null }) {
  const rf = ruleFlagStyle(ruleFlag)
  return (
    <div className="max-w-md">
      <div className="truncate text-zinc-200" title={question}>{question}</div>
      <div className="mt-1 flex gap-1.5">
        {cohort && (
          <span className={`rounded border px-1.5 py-0 text-[10px] ${cohortChip(cohort)}`}>
            {cohort === "politics" ? "政治" : cohort === "data" ? "数据" : cohort}
          </span>
        )}
        {ruleFlag && <span className={`rounded border px-1.5 py-0 text-[10px] ${rf.badge}`}>{rf.label}</span>}
      </div>
    </div>
  )
}

export function OpenOrdersTable({ rows }: { rows: OpenOrderRow[] }) {
  return (
    <div className={`${PANEL} overflow-x-auto p-4`}>
      <h3 className="mb-3 text-sm font-semibold text-zinc-200">
        当前挂单 <span className="ml-1 text-xs font-normal text-zinc-500">{rows.length} 单(orders.jsonl 事件重放)</span>
      </h3>
      <table className="w-full min-w-[720px] text-xs">
        <thead className="border-b border-zinc-800 text-zinc-500">
          <tr>
            <th className="px-3 py-2 text-left font-medium">market</th>
            <th className="px-3 py-2 text-left font-medium">side</th>
            <th className="px-3 py-2 text-right font-medium">limit</th>
            <th className="px-3 py-2 text-right font-medium">shares</th>
            <th className="px-3 py-2 text-right font-medium">mid@挂单</th>
            <th className="px-3 py-2 text-left font-medium">挂单时间</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={6} text="暂无挂单" />
          ) : (
            rows.map((o) => (
              <tr key={o.order_id} className="border-b border-zinc-800/60 hover:bg-zinc-900/40">
                <td className="px-3 py-2">
                  <QuestionCell question={o.question} cohort={o.cohort} ruleFlag={o.rule_flag} />
                </td>
                <td className={`px-3 py-2 font-semibold ${sideColor(o.side)}`}>{o.side}</td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-300">{o.limit.toFixed(3)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-300">{o.shares.toFixed(2)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-400">{o.mid_at_order.toFixed(3)}</td>
                <td className="px-3 py-2 text-zinc-500">{fmtTime(o.ts)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

export function PositionsTable({ rows }: { rows: PositionRow[] }) {
  return (
    <div className={`${PANEL} overflow-x-auto p-4`}>
      <h3 className="mb-3 text-sm font-semibold text-zinc-200">
        持仓(已成交待结算) <span className="ml-1 text-xs font-normal text-zinc-500">{rows.length} 笔(fills.jsonl)</span>
      </h3>
      <table className="w-full min-w-[640px] text-xs">
        <thead className="border-b border-zinc-800 text-zinc-500">
          <tr>
            <th className="px-3 py-2 text-left font-medium">market</th>
            <th className="px-3 py-2 text-left font-medium">side</th>
            <th className="px-3 py-2 text-right font-medium">成交价</th>
            <th className="px-3 py-2 text-right font-medium">shares</th>
            <th className="px-3 py-2 text-right font-medium">成本</th>
            <th className="px-3 py-2 text-left font-medium">成交时间</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={6} text="暂无持仓 —— 等待数据积累(尚未有挂单成交)" />
          ) : (
            rows.map((f) => (
              <tr key={f.order_id} className="border-b border-zinc-800/60 hover:bg-zinc-900/40">
                <td className="px-3 py-2">
                  <QuestionCell question={f.question} cohort={f.cohort} ruleFlag={null} />
                </td>
                <td className={`px-3 py-2 font-semibold ${sideColor(f.side)}`}>{f.side}</td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-300">{f.fill_price.toFixed(3)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-300">{f.shares.toFixed(2)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-400">${f.cost.toFixed(2)}</td>
                <td className="px-3 py-2 text-zinc-500">{fmtTime(f.fill_ts)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
