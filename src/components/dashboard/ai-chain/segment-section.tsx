import type { ChainSegment, ChainStock, Quote } from "@/lib/ai-chain-pure"
import { fmtPct, fmtPrice, fmtMcap, CP_WEIGHT } from "@/lib/ai-chain-pure"
import { CP, SIGNAL, SOURCE_LABEL, PANEL, pctColor } from "./theme"

export interface StockView {
  stock: ChainStock
  quote: Quote | null
  /** serenity 活账本 active 持仓的 stance(如 "加码"),null = 白毛未持仓 */
  serenityStance: string | null
  focus: boolean
}

function StockCard({ v }: { v: StockView }) {
  const { stock, quote } = v
  const cp = CP[stock.cp]
  return (
    <div
      className={`group relative flex flex-col gap-1.5 rounded-xl border p-3 transition-colors hover:border-zinc-600/70 ${cp.card} ${
        stock.holding ? "ring-1 ring-emerald-500/40" : ""
      }`}
    >
      {/* 行1:ticker + CP 徽章 + 重点星 */}
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-sm font-semibold text-zinc-100">{stock.ticker}</span>
        <span className={`rounded-full border px-1.5 py-px text-[10px] leading-4 ${cp.badge}`}>
          {cp.label}
          {stock.cpNote ? `·${stock.cpNote}` : ""}
        </span>
        {v.focus && (
          <span className="text-[10px] text-amber-400/90" title="环节内研究优先级">
            ★
          </span>
        )}
        {quote?.mcap != null && (
          <span className="ml-auto font-mono text-[10px] text-zinc-500">{fmtMcap(quote.mcap)}</span>
        )}
      </div>

      {/* 行2:中文名 + 定位 */}
      <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
        <span>{stock.name}</span>
        <span className="text-zinc-600">·</span>
        <span className="text-zinc-500">{stock.position}</span>
        {stock.holding && (
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/12 px-1.5 text-[10px] text-emerald-300">
            持仓
          </span>
        )}
        {v.serenityStance && (
          <span
            className="rounded-full border border-violet-500/30 bg-violet-500/12 px-1.5 text-[10px] text-violet-300"
            title={`白毛女活账本 active 持仓:${v.serenityStance}`}
          >
            白毛·{v.serenityStance}
          </span>
        )}
      </div>

      {/* 行3:价格 + 涨跌 */}
      <div className="flex items-baseline gap-2 font-mono">
        <span className="text-sm text-zinc-200">{quote ? `$${fmtPrice(quote.price)}` : "—"}</span>
        <span className={`text-xs ${pctColor(quote?.chg1d ?? null)}`}>{fmtPct(quote?.chg1d ?? null)}</span>
        <span className="ml-auto text-[10px] text-zinc-500">
          1M <span className={pctColor(quote?.chg1m ?? null)}>{fmtPct(quote?.chg1m ?? null)}</span>
          {" · YTD "}
          <span className={pctColor(quote?.chgYtd ?? null)}>{fmtPct(quote?.chgYtd ?? null)}</span>
        </span>
      </div>

      {/* 行4:一句话业务 + 备注(hover 看全文) */}
      <p className="text-[11px] leading-4 text-zinc-400">{stock.desc}</p>
      <p className="line-clamp-2 text-[10px] leading-4 text-zinc-500" title={stock.note}>
        {stock.note}
      </p>

      {/* 行5:信号 chips */}
      {stock.signals.length > 0 && (
        <div className="mt-auto flex flex-wrap gap-1 pt-1">
          {stock.signals.map((s, i) => {
            const st = SIGNAL[s.type]
            return (
              <span
                key={i}
                className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] leading-4 ${st.chip}`}
                title={`[${s.date} ${SOURCE_LABEL[s.source]}] ${s.note}${s.ref ? `\n→ ${s.ref}` : ""}`}
              >
                <span>{st.icon}</span>
                <span>{SOURCE_LABEL[s.source]}</span>
                <span className="opacity-70">{s.date.slice(5)}</span>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function SegmentSection({
  segment,
  views,
  index,
}: {
  segment: ChainSegment
  views: StockView[]
  index: number
}) {
  // CP 强者靠前,同档保持 JSON 原序(vault 侧已按重要度排)。
  const sorted = [...views].sort((a, b) => CP_WEIGHT[b.stock.cp] - CP_WEIGHT[a.stock.cp])
  return (
    <section className={`${PANEL} p-4 sm:p-5`}>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold text-zinc-100">
          <span className="mr-2 font-mono text-xs text-zinc-600">{String(index).padStart(2, "0")}</span>
          {segment.name}
        </h2>
        <span className="text-xs text-zinc-500">{views.length} 只</span>
      </div>
      <p className="mb-4 max-w-4xl text-xs leading-5 text-zinc-400">{segment.role}</p>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {sorted.map((v) => (
          <StockCard key={v.stock.ticker} v={v} />
        ))}
      </div>
    </section>
  )
}
