"use client"

/**
 * 真金交易回放（tick-v1）：每笔单一张小倍数图，画**买入侧份额价格**在窗口内的
 * tick 级路径（0..1）。线=买入 token 中价，淡带=买一/卖一价差；赢单收敛到 ~1、
 * 亏单崩向 ~0。▼=买入(限价+成交秒)；小点=该 token 的真实成交打印(last_trade_price)；
 * 右端收敛到 1(绿)/0(红)=结算。悬停出十字线+数值。
 * 数据每 5 分钟自增再生(gen_trades_viz.py)，滚动最近 20 笔。
 */
import { useMemo, useState } from "react"
import type { ReplayTrade, ReplayPoint } from "@/lib/pm-scalp-replay-reader"
import { cn } from "@/lib/utils"

const W = 320
const H = 138
const PAD = { l: 26, r: 8, t: 8, b: 16 }

type Zoom = "full" | "tail"

function fmtUsd(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : ""
  return `${sign}$${Math.abs(n).toFixed(2)}`
}

function MiniChart({ t, zoom }: { t: ReplayTrade; zoom: Zoom }) {
  const [hover, setHover] = useState<ReplayPoint | null>(null)

  const { pts, prints, x, y, x0, x1 } = useMemo(() => {
    const x0 = zoom === "tail" ? 240 : 0
    const x1 = 300
    const pts = t.series.filter((p) => p.s >= x0 && p.s <= x1)
    const prints = t.prints.filter((p) => p.s >= x0 && p.s <= x1)
    // y 轴固定 0..1（份额价格空间；跨图可比,不像位移那样需各自缩放）
    const x = (s: number) => PAD.l + ((s - x0) / (x1 - x0)) * (W - PAD.l - PAD.r)
    const y = (v: number) => PAD.t + (1 - v) * (H - PAD.t - PAD.b)
    return { pts, prints, x, y, x0, x1 }
  }, [t, zoom])

  if (pts.length < 4) {
    return <p className="text-xs text-zinc-500">该窗口 tick 轨迹缺失</p>
  }

  const midLine = pts
    .map((p) => `${x(p.s).toFixed(1)},${y((p.bid + p.ask) / 2).toFixed(1)}`)
    .join(" ")
  // 买一/卖一价差带（上沿=ask 正序，下沿=bid 逆序折返）
  const bandTop = pts.map((p) => `${x(p.s).toFixed(1)},${y(p.ask).toFixed(1)}`)
  const bandBot = pts
    .slice()
    .reverse()
    .map((p) => `${x(p.s).toFixed(1)},${y(p.bid).toFixed(1)}`)
  const band = `${bandTop.join(" ")} ${bandBot.join(" ")}`

  const entryVisible = t.sEntry != null && t.sEntry >= x0 && t.sEntry <= x1
  const entryPt =
    entryVisible && t.sEntry != null
      ? pts.reduce((a, b) =>
          Math.abs(b.s - t.sEntry!) < Math.abs(a.s - t.sEntry!) ? b : a,
        )
      : null
  const last = pts[pts.length - 1]
  const lastMid = (last.bid + last.ask) / 2

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const vx = ((e.clientX - rect.left) / rect.width) * W
    const frac = (vx - PAD.l) / (W - PAD.l - PAD.r)
    const sx = x0 + Math.max(0, Math.min(1, frac)) * (x1 - x0)
    let best = pts[0]
    for (const p of pts) if (Math.abs(p.s - sx) < Math.abs(best.s - sx)) best = p
    setHover(best)
  }

  const lineColor = t.filled ? "#22d3ee" : "#71717a" // 未成交灰线

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none"
        role="img"
        aria-label={`${t.windowLabel} ${t.side}@${t.limit} ${
          t.won == null ? "未成交" : t.won ? "胜" : "负"
        } ${fmtUsd(t.pnl)}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {/* 0.5 参考线 = 公允 */}
        <line x1={PAD.l} x2={W - PAD.r} y1={y(0.5)} y2={y(0.5)}
          stroke="#3f3f46" strokeWidth="1" strokeDasharray="2 3" />
        {/* y 轴刻度 0 / .5 / 1（份额价） */}
        {[0, 0.5, 1].map((v) => (
          <text key={v} x={PAD.l - 4} y={y(v) + 3} textAnchor="end"
            className="fill-zinc-500" fontSize="8">
            {v === 0.5 ? ".5" : v}
          </text>
        ))}
        {/* x 轴刻度 */}
        {(zoom === "tail" ? [240, 270, 300] : [0, 100, 200, 300]).map((s) => (
          <text key={s} x={x(s)} y={H - 4} textAnchor="middle"
            className="fill-zinc-600" fontSize="8">
            {s}s
          </text>
        ))}
        {/* 买一/卖一价差带 */}
        <polygon points={band} fill={lineColor} opacity={0.12} />
        {/* 真实成交打印 */}
        {prints.map((p, i) => (
          <circle key={i} cx={x(p.s)} cy={y(p.price)} r="1.1"
            fill="#fbbf24" opacity={0.6} />
        ))}
        {/* 中价路径 */}
        <polyline points={midLine} fill="none" stroke={lineColor}
          strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
        {/* 买入点 */}
        {entryPt && (
          <>
            <line x1={x(entryPt.s)} x2={x(entryPt.s)} y1={PAD.t} y2={H - PAD.b}
              stroke="#a1a1aa" strokeWidth="1" strokeDasharray="2 3" />
            <circle cx={x(entryPt.s)} cy={y(t.limit)} r="4"
              fill={t.filled ? "#22d3ee" : "#71717a"} stroke="#18181b"
              strokeWidth="1.5" />
            <text x={x(entryPt.s)} y={PAD.t + 8} textAnchor="middle"
              className="fill-zinc-400" fontSize="8">
              ▼{t.filled ? "买" : "挂"}@{t.limit.toFixed(2)}
            </text>
          </>
        )}
        {/* 终点 = 结算收敛 */}
        <circle cx={x(last.s)} cy={y(lastMid)} r="3.5"
          fill={t.won == null ? "#a1a1aa" : t.won ? "#34d399" : "#fb7185"}
          stroke="#18181b" strokeWidth="1.5" />
        {/* 悬停十字线 */}
        {hover && (
          <line x1={x(hover.s)} x2={x(hover.s)} y1={PAD.t} y2={H - PAD.b}
            stroke="#e4e4e7" strokeWidth="0.6" opacity={0.5} />
        )}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 rounded border border-zinc-700 bg-zinc-900/95 px-2 py-1 text-[10px] tabular-nums text-zinc-200 shadow-lg">
          s{hover.s.toFixed(1)} · {t.side}价 {((hover.bid + hover.ask) / 2).toFixed(2)}
          <span className="text-zinc-500"> ({hover.bid.toFixed(2)}/{hover.ask.toFixed(2)})</span>
        </div>
      )}
    </div>
  )
}

export function TradeReplayGrid({
  trades,
  fileMissing,
}: {
  trades: ReplayTrade[]
  fileMissing: boolean
}) {
  const [zoom, setZoom] = useState<Zoom>("tail")
  if (trades.length === 0) {
    return (
      <p className="mt-3 text-xs text-zinc-500">
        {fileMissing
          ? "回放数据文件缺失（analysis/trades-viz.json,由 gen_trades_viz.py 每 5min 自增再生）"
          : "回放数据文件存在但无可展示的成交(空或格式不符)"}
      </p>
    )
  }
  return (
    <div className="mt-3">
      <div className="mb-3 flex items-center gap-2">
        {([["tail", "末 60s"], ["full", "全窗 300s"]] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setZoom(k)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs",
              zoom === k
                ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
                : "border-zinc-700 text-zinc-400 hover:text-zinc-200",
            )}
          >
            {label}
          </button>
        ))}
        <span className="text-[11px] text-zinc-500">
          线=买入侧份额价(tick 级) · 淡带=买一/卖一 · 黄点=真实成交 · 赢→1 亏→0 · 各图 y 轴 0..1 同标
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {trades.map((t) => (
          <div
            key={t.w}
            className={cn(
              "rounded-xl border bg-zinc-950/40 p-2.5",
              t.won == null
                ? "border-zinc-800"
                : t.won
                  ? "border-emerald-900/40"
                  : "border-rose-900/40",
            )}
          >
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="text-zinc-300 tabular-nums">
                {t.windowLabel}
                <span
                  className={cn(
                    "ml-2",
                    t.side === "Up" ? "text-emerald-300/90" : "text-rose-300/90",
                  )}
                >
                  {t.side}@{t.limit.toFixed(2)}
                </span>
                {t.q != null && (
                  <span className="ml-2 text-zinc-500">q{t.q.toFixed(2)}</span>
                )}
                <span className="ml-1 text-zinc-600">{t.strategy}</span>
              </span>
              <span
                className={cn(
                  "font-semibold tabular-nums",
                  t.won == null
                    ? "text-zinc-400"
                    : t.won
                      ? "text-emerald-400"
                      : "text-rose-400",
                )}
              >
                {t.won == null ? "未成交" : t.won ? "胜" : "负"}
                {t.filled && ` ${fmtUsd(t.pnl)}`}
              </span>
            </div>
            <MiniChart t={t} zoom={zoom} />
          </div>
        ))}
      </div>
    </div>
  )
}
