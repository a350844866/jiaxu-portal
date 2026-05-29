import type { Position } from "@/lib/serenity-pure"
import { STANCE, STANCE_WEIGHT, TIER, TIER_ORDER, inferTier, type TierKey } from "./theme"

// 持仓按产业链 tier 分大组(上游→中游→终端→基础设施),tier 内按信号强度排序。
// 卡片左侧 accent 竖条 = stance 颜色,扫一眼就知道一层里哪些在加码、哪些在减。
export function HoldingsGrid({
  positions,
  onPickTicker,
}: {
  positions: Position[]
  onPickTicker?: (ticker: string) => void
}) {
  const byTier = new Map<TierKey, Position[]>()
  for (const p of positions) {
    const t = inferTier(p.chain)
    const arr = byTier.get(t) ?? []
    arr.push(p)
    byTier.set(t, arr)
  }
  for (const arr of byTier.values()) {
    arr.sort(
      (a, b) =>
        (STANCE_WEIGHT[b.stance] ?? 0) - (STANCE_WEIGHT[a.stance] ?? 0) ||
        b.last_mention.localeCompare(a.last_mention),
    )
  }

  return (
    <div className="space-y-5">
      {TIER_ORDER.filter((t) => byTier.has(t)).map((t) => {
        const tier = TIER[t]
        const items = byTier.get(t)!
        return (
          <div key={t}>
            <div
              className="mb-2.5 flex items-center gap-2"
              title="产业链分层为按 chain 文本启发式推断,以卡片内 chain 原文为准"
            >
              <span className="h-2 w-2 rounded-full" style={{ background: tier.hex }} />
              <span className="text-[11px] font-medium text-zinc-300">{tier.label}</span>
              <span className="text-[10px] text-zinc-500">{tier.sub}</span>
              <span className="text-[9px] text-zinc-600">· 推断</span>
              <span className="ml-auto text-[10px] tabular-nums text-zinc-500">{items.length} 仓</span>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((p) => {
                const st = STANCE[p.stance] ?? STANCE.持有
                return (
                  <button
                    key={p.ticker}
                    type="button"
                    onClick={() => onPickTicker?.(p.ticker)}
                    className={`group relative overflow-hidden rounded-xl border p-3 pl-4 text-left transition-all duration-200 ${st.card} ${onPickTicker ? `cursor-pointer hover:-translate-y-0.5 hover:shadow-lg ${st.hover}` : ""}`}
                  >
                    {/* 左侧 stance accent 竖条 */}
                    <span
                      className="absolute inset-y-2 left-1.5 w-[3px] rounded-full"
                      style={{ background: st.hex }}
                    />
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm font-semibold text-zinc-100">${p.ticker}</span>
                      <span className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] ${st.badge}`}>
                        {st.icon} {st.label}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-400">
                      <span className="truncate">{p.name}</span>
                      <span className="text-zinc-600">·</span>
                      <span className="shrink-0 text-zinc-500">{p.instrument}</span>
                    </div>
                    <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-zinc-300/90">{p.thesis}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="font-mono text-[10px] text-zinc-600">{p.chain}</span>
                      <span className="flex items-center gap-1 text-[10px] text-zinc-600">
                        <span className="hidden text-sky-400/80 group-hover:inline">看原推 →</span>
                        <span className="group-hover:hidden">{p.last_mention}</span>
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
