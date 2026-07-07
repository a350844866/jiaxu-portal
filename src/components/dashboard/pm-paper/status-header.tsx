import { CircleAlert } from "lucide-react"
import { PANEL, pnlColor, brierWinner } from "./theme"
import type { PmPaperDetail } from "@/lib/pm-paper-detail-reader"

function fmtUsd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—"
  const sign = n > 0 ? "+" : ""
  return `${sign}$${n.toFixed(2)}`
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—"
  const sign = n > 0 ? "+" : ""
  return `${sign}${(n * 100).toFixed(1)}%`
}

function fmtBrier(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—"
  return n.toFixed(3)
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 px-3 py-2.5">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-100">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-zinc-600">{sub}</div>}
    </div>
  )
}

function BrierPair({ claude, market }: { claude: number | null; market: number | null }) {
  const winner = brierWinner(claude, market)
  return (
    <div className="flex items-baseline gap-3 text-xs">
      <span className={`font-semibold tabular-nums ${winner === true ? "text-emerald-400" : winner === false ? "text-rose-400" : "text-zinc-300"}`}>
        Claude {fmtBrier(claude)}
      </span>
      <span className={`font-semibold tabular-nums ${winner === false ? "text-emerald-400" : winner === true ? "text-rose-400" : "text-zinc-300"}`}>
        市场 {fmtBrier(market)}
      </span>
    </div>
  )
}

export function StatusHeader({ detail }: { detail: PmPaperDetail }) {
  const gate = detail.tradeGate
  const overall = detail.overall
  const gateN = gate?.n_settled_trades ?? 0
  const gateTarget = gate?.gate_n_target ?? 30
  const gatePct = Math.min(100, Math.round((gateN / Math.max(1, gateTarget)) * 100))

  return (
    <div className="space-y-4">
      {detail.halt && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">
          <CircleAlert className="h-4 w-4 shrink-0" />
          熔断中(HALT)—— 模拟回撤触发 30% 保护阈值,executor 已停止新挂单
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="bankroll" value={detail.bankroll != null ? `$${detail.bankroll.toFixed(0)}` : "—"} />
        <Tile label="committed(挂单+持仓占用)" value={detail.committed != null ? `$${detail.committed.toFixed(2)}` : "—"} />
        <Tile label="available" value={detail.available != null ? `$${detail.available.toFixed(2)}` : "—"} />
      </div>

      <div className={`${PANEL} p-4`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-zinc-200">上真钱门槛(权威口径)</h3>
          <span className="text-[11px] text-zinc-500">
            仅计已成交结算 —— 与下方&ldquo;全预测校准&rdquo;是两个不同指标,不要混用
          </span>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500/70 to-emerald-400/90"
              style={{ width: `${gatePct}%` }}
            />
          </div>
          <span className="shrink-0 text-xs tabular-nums text-zinc-300">
            {gateN} / {gateTarget}
          </span>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <div className="text-[11px] text-zinc-500">已成交结算 P&amp;L</div>
            <div className={`mt-0.5 text-sm font-semibold tabular-nums ${pnlColor(gate?.pnl)}`}>
              {fmtUsd(gate?.pnl)}
              <span className="ml-1.5 text-[11px] font-normal text-zinc-500">{fmtPct(gate?.roi_on_cost)} ROI</span>
            </div>
          </div>
          <div>
            <div className="text-[11px] text-zinc-500">Brier(已成交,越低越准)</div>
            <div className="mt-0.5">
              <BrierPair claude={gate?.brier_claude ?? null} market={gate?.brier_market ?? null} />
            </div>
          </div>
          <div>
            <div className="text-[11px] text-zinc-500">政治盘子集</div>
            <div className={`mt-0.5 text-sm font-semibold tabular-nums ${pnlColor(gate?.politics_pnl)}`}>
              {fmtUsd(gate?.politics_pnl)}
              <span className="ml-1.5 text-[11px] font-normal text-zinc-500">{gate?.politics_n ?? 0} 单</span>
            </div>
          </div>
        </div>
      </div>

      <div className={`${PANEL} p-4`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-zinc-200">全预测校准(研究口径)</h3>
          <span className="text-[11px] text-zinc-500">
            覆盖全部已结算预测,不要求实际成交 —— 衡量方向感,不是真实盈亏
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-xs">
          <span className="text-zinc-400">
            已结算预测 <span className="font-semibold tabular-nums text-zinc-200">{overall?.n_settled_predictions ?? 0}</span>
          </span>
          <span className="text-zinc-400">
            已结算持仓 <span className="font-semibold tabular-nums text-zinc-200">{overall?.n_settled_positions ?? 0}</span>
          </span>
          <span className="text-zinc-400">
            挂单中 <span className="font-semibold tabular-nums text-zinc-200">{overall?.n_open_orders ?? 0}</span>
          </span>
          <span className="text-zinc-400">
            累计成交 <span className="font-semibold tabular-nums text-zinc-200">{overall?.n_fills_total ?? 0}</span>
          </span>
          <BrierPair claude={overall?.brier_claude ?? null} market={overall?.brier_market ?? null} />
        </div>
      </div>
    </div>
  )
}
