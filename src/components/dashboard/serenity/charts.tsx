import type { Verdict } from "@/lib/serenity-pure"
import { VERDICT } from "./theme"

// ── 活跃脉搏:发推量按天的紧凑 sparkline(hero 用)──
export function Sparkline({
  data,
  className = "",
}: {
  data: { day: string; count: number }[]
  className?: string
}) {
  if (!data.length) return null
  const max = Math.max(1, ...data.map((d) => d.count))
  return (
    <div className={`flex items-end gap-[3px] ${className}`}>
      {data.map((d) => (
        <div
          key={d.day}
          title={`${d.day}: ${d.count} 推`}
          className="w-1.5 rounded-sm bg-gradient-to-t from-sky-500/30 to-sky-400/70"
          style={{ height: d.count === 0 ? "2px" : `${Math.max(8, (d.count / max) * 100)}%` }}
        />
      ))}
    </div>
  )
}

// ── ticker 提及热度:注意力分配,印证持仓(盯仓幕用)──
export function TickerHeatChart({ data }: { data: { ticker: string; count: number }[] }) {
  const top = data.slice(0, 10)
  const max = Math.max(1, ...top.map((d) => d.count))
  if (!top.length) {
    return <p className="text-xs text-zinc-600">窗口内无 ticker 提及</p>
  }
  return (
    <div className="space-y-2">
      {top.map((d, i) => (
        <div key={d.ticker} className="group flex items-center gap-2.5">
          <span className="w-4 text-right text-[10px] tabular-nums text-zinc-600">{i + 1}</span>
          <span className="w-16 font-mono text-[11px] text-zinc-300">${d.ticker}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800/60">
            <div
              className="h-full rounded-full bg-gradient-to-r from-rose-500/50 to-rose-400/80 transition-all duration-500 group-hover:from-rose-400/70 group-hover:to-rose-300"
              style={{ width: `${(d.count / max) * 100}%` }}
            />
          </div>
          <span className="w-6 text-right text-[10px] tabular-nums text-zinc-500">{d.count}</span>
        </div>
      ))}
    </div>
  )
}

// ── 预测判定环本体(只画环 + 中心数字,legend 由调用方排版)──
export function DonutChart({
  data,
  size = 132,
}: {
  data: { verdict: Verdict; count: number }[]
  size?: number
}) {
  const total = data.reduce((s, d) => s + d.count, 0)
  if (!total) {
    return (
      <div
        className="flex items-center justify-center rounded-full border border-dashed border-zinc-700 text-[11px] text-zinc-600"
        style={{ width: size, height: size }}
      >
        暂无
      </div>
    )
  }
  const R = 42
  const C = 2 * Math.PI * R
  let acc = 0
  // 单段 100% 用整圆(避免 dash 长度恰等于周长时的接缝)。
  const single = data.length === 1
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={R} fill="none" stroke="#27272a" strokeWidth="11" />
        {single ? (
          <circle cx="50" cy="50" r={R} fill="none" stroke={VERDICT[data[0].verdict]?.hex ?? "#71717a"} strokeWidth="11" />
        ) : (
          data.map((d) => {
            const frac = d.count / total
            const el = (
              <circle
                key={d.verdict}
                cx="50"
                cy="50"
                r={R}
                fill="none"
                stroke={VERDICT[d.verdict]?.hex ?? "#71717a"}
                strokeWidth="11"
                strokeDasharray={`${frac * C} ${C}`}
                strokeDashoffset={-acc * C}
                strokeLinecap="butt"
              />
            )
            acc += frac
            return el
          })
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold tabular-nums leading-none text-zinc-100">{total}</span>
        <span className="text-[10px] text-zinc-500">条预测</span>
      </div>
    </div>
  )
}
