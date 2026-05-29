import type { Position, Stance } from "@/lib/serenity-pure"

const STANCE_TONE: Record<Stance, string> = {
  新开: "border-emerald-500/40 bg-emerald-500/5 text-emerald-200",
  加码: "border-rose-500/40 bg-rose-500/5 text-rose-200",
  持有: "border-zinc-600/40 bg-zinc-700/10 text-zinc-200",
  减仓: "border-sky-500/40 bg-sky-500/5 text-sky-200",
  反手做空: "border-fuchsia-500/40 bg-fuchsia-500/5 text-fuchsia-200",
  转静默: "border-zinc-700/40 bg-zinc-800/20 text-zinc-400",
  观察: "border-yellow-500/30 bg-yellow-500/5 text-yellow-200",
}

const STANCE_ICON: Record<Stance, string> = {
  新开: "🆕", 加码: "🔥", 持有: "➡️", 减仓: "📉", 反手做空: "🔄", 转静默: "🤫", 观察: "👀",
}

export function HoldingsGrid({
  positions,
  onPickTicker,
}: {
  positions: Position[]
  onPickTicker?: (ticker: string) => void
}) {
  // Group by chain
  const byChain = new Map<string, Position[]>()
  for (const p of positions) {
    if (!byChain.has(p.chain)) byChain.set(p.chain, [])
    byChain.get(p.chain)!.push(p)
  }
  return (
    <section className="space-y-4">
      {Array.from(byChain.entries()).map(([chain, items]) => (
        <div key={chain}>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">{chain}</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((p) => (
              <button
                key={p.ticker}
                type="button"
                onClick={() => onPickTicker?.(p.ticker)}
                className={`rounded-xl border p-3 text-left ${STANCE_TONE[p.stance] ?? STANCE_TONE.持有} ${onPickTicker ? "cursor-pointer hover:brightness-125" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-semibold">${p.ticker}</span>
                  <span className="text-xs">{STANCE_ICON[p.stance] ?? ""} {p.stance}</span>
                </div>
                <div className="mt-1 text-[11px] text-zinc-400">{p.name} · {p.instrument}</div>
                <p className="mt-2 text-xs leading-relaxed text-zinc-300">{p.thesis}</p>
                <div className="mt-2 text-[10px] text-zinc-500">最近提及 {p.last_mention}</div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}
