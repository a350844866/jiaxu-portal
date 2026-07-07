import { PANEL } from "./theme"
import type { CalibrationBucket } from "@/lib/pm-paper-reader"

export function CalibrationTable({ buckets }: { buckets: CalibrationBucket[] }) {
  return (
    <div className={`${PANEL} overflow-x-auto p-4`}>
      <h3 className="mb-1 text-sm font-semibold text-zinc-200">校准分桶</h3>
      <p className="mb-3 text-[11px] text-zinc-500">
        p_mean(该桶预测概率均值)vs outcome_rate(实际发生频率)—— 越贴近对角线越校准
      </p>
      {buckets.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-zinc-600">样本不足,暂无校准分桶(需要已结算样本)</div>
      ) : (
        <table className="w-full min-w-[480px] text-xs">
          <thead className="border-b border-zinc-800 text-zinc-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">bucket</th>
              <th className="px-3 py-2 text-right font-medium">n</th>
              <th className="px-3 py-2 text-right font-medium">p_mean</th>
              <th className="px-3 py-2 text-right font-medium">outcome_rate</th>
              <th className="px-3 py-2 text-left font-medium">对比</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={String(b.bucket)} className="border-b border-zinc-800/60 hover:bg-zinc-900/40">
                <td className="px-3 py-2 font-mono text-zinc-300">{b.bucket}</td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-400">{b.n}</td>
                <td className="px-3 py-2 text-right tabular-nums text-sky-300">{b.p_mean.toFixed(3)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-300">{b.outcome_rate.toFixed(3)}</td>
                <td className="px-3 py-2">
                  <div className="relative h-2 w-32 rounded-full bg-zinc-800">
                    <div
                      className="absolute top-0 h-2 w-0.5 rounded-full bg-sky-400"
                      style={{ left: `${Math.min(100, Math.max(0, b.p_mean * 100))}%` }}
                      title={`p_mean ${b.p_mean.toFixed(3)}`}
                    />
                    <div
                      className="absolute top-0 h-2 w-0.5 rounded-full bg-emerald-400"
                      style={{ left: `${Math.min(100, Math.max(0, b.outcome_rate * 100))}%` }}
                      title={`outcome_rate ${b.outcome_rate.toFixed(3)}`}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
