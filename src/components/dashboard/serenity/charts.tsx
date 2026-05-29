import type { Verdict } from "@/lib/serenity-pure"

const VERDICT_COLOR: Record<string, string> = {
  兑现: "#34d399", 落空: "#f87171", 待核: "#fbbf24", 不可证伪: "#71717a", 归因不稳: "#a78bfa",
}

export function PostVolumeChart({ data }: { data: { day: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count))
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <h3 className="mb-3 text-xs font-medium text-zinc-400">发推量(按天)</h3>
      <div className="flex h-28 items-end gap-1">
        {data.map((d) => (
          <div key={d.day} className="flex flex-1 flex-col items-center justify-end" title={`${d.day}: ${d.count}`}>
            <div className="w-full rounded-t bg-sky-500/60" style={{ height: `${(d.count / max) * 100}%` }} />
            <span className="mt-1 text-[8px] text-zinc-600">{d.day.slice(5)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function TickerHeatChart({ data }: { data: { ticker: string; count: number }[] }) {
  const top = data.slice(0, 12)
  const max = Math.max(1, ...top.map((d) => d.count))
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <h3 className="mb-3 text-xs font-medium text-zinc-400">ticker 提及热度</h3>
      <div className="space-y-1.5">
        {top.map((d) => (
          <div key={d.ticker} className="flex items-center gap-2">
            <span className="w-16 font-mono text-[11px] text-zinc-300">${d.ticker}</span>
            <div className="h-3 flex-1 rounded bg-zinc-900">
              <div className="h-3 rounded bg-rose-500/60" style={{ width: `${(d.count / max) * 100}%` }} />
            </div>
            <span className="w-6 text-right text-[10px] text-zinc-500">{d.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function VerdictDonut({ data }: { data: { verdict: Verdict; count: number }[] }) {
  const total = data.reduce((s, d) => s + d.count, 0) || 1
  let acc = 0
  const R = 40, C = 2 * Math.PI * R
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <h3 className="mb-3 text-xs font-medium text-zinc-400">预测判定分布</h3>
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 100 100" className="h-28 w-28 -rotate-90">
          {data.map((d) => {
            const frac = d.count / total
            const dash = `${frac * C} ${C}`
            const el = (
              <circle key={d.verdict} cx="50" cy="50" r={R} fill="none"
                stroke={VERDICT_COLOR[d.verdict] ?? "#71717a"} strokeWidth="14"
                strokeDasharray={dash} strokeDashoffset={-acc * C} />
            )
            acc += frac
            return el
          })}
        </svg>
        <ul className="space-y-1 text-[11px]">
          {data.map((d) => (
            <li key={d.verdict} className="flex items-center gap-1.5 text-zinc-300">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: VERDICT_COLOR[d.verdict] ?? "#71717a" }} />
              {d.verdict} <span className="text-zinc-500">{d.count}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
