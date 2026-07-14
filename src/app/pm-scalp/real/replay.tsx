"use client"

/**
 * 真金交易回放：每笔已结算单一张小倍数折线图。
 * 线 = Chainlink 相对开窗 strike 的位移(bps)；虚线 0 = 开窗价；
 * 淡色半区 = 买入侧的"胜区"（收窗时位移落在该半区即赢）；
 * ▼ + 圆点 = 买入时刻。悬停出十字线 + 数值。
 * y 轴各图独立（位移量级差异大，统一轴会压平小位移窗）。
 */
import { useMemo, useState } from "react"
import type { ReplayTrade, ReplayPoint } from "@/lib/pm-scalp-replay-reader"
import { cn } from "@/lib/utils"

const W = 320
const H = 132
const PAD = { l: 30, r: 8, t: 8, b: 16 }

type Zoom = "full" | "tail"

function fmtUsd(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : ""
  return `${sign}$${Math.abs(n).toFixed(2)}`
}

function MiniChart({ t, zoom }: { t: ReplayTrade; zoom: Zoom }) {
  const [hover, setHover] = useState<ReplayPoint | null>(null)

  const { pts, x, y, yMax, x0, x1 } = useMemo(() => {
    const x0 = zoom === "tail" ? 240 : 0
    const x1 = 300
    const pts = t.series.filter((p) => p.s >= x0 && p.s <= x1)
    let ext = 0.5
    for (const p of pts) ext = Math.max(ext, Math.abs(p.disp))
    ext = Math.max(ext, Math.abs(t.dispEntry)) * 1.15
    const x = (s: number) => PAD.l + ((s - x0) / (x1 - x0)) * (W - PAD.l - PAD.r)
    const y = (d: number) => PAD.t + ((ext - d) / (2 * ext)) * (H - PAD.t - PAD.b)
    return { pts, x, y, yMax: ext, x0, x1 }
  }, [t, zoom])

  if (pts.length < 5) {
    return <p className="text-xs text-zinc-500">该窗口 1Hz 轨迹缺失</p>
  }

  const line = pts.map((p) => `${x(p.s).toFixed(1)},${y(p.disp).toFixed(1)}`).join(" ")
  const zeroY = y(0)
  const winTop = t.side === "Up" // Up 买家胜区在 0 线上方
  // 买入点在缩放窗之外时不画标记(review LOW-5),避免钉在左缘误导
  const entryVisible = t.sEntry >= x0 && t.sEntry <= x1
  const entryPt = entryVisible
    ? pts.reduce((a, b) => (Math.abs(b.s - t.sEntry) < Math.abs(a.s - t.sEntry) ? b : a))
    : null
  const last = pts[pts.length - 1]

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    // 反演比例尺要扣绘图区 padding(review MED-2),否则左缘偏移 ~PAD.l/W·span
    const rect = e.currentTarget.getBoundingClientRect()
    const vx = ((e.clientX - rect.left) / rect.width) * W
    const frac = (vx - PAD.l) / (W - PAD.l - PAD.r)
    const sx = x0 + Math.max(0, Math.min(1, frac)) * (x1 - x0)
    let best = pts[0]
    for (const p of pts) if (Math.abs(p.s - sx) < Math.abs(best.s - sx)) best = p
    setHover(best)
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none"
        role="img"
        aria-label={`${t.windowLabel} ${t.side}@${t.px} ${t.won ? "胜" : "负"} ${fmtUsd(t.pnl)}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {/* 买入侧胜区淡色 */}
        <rect
          x={PAD.l} width={W - PAD.l - PAD.r}
          y={winTop ? PAD.t : zeroY}
          height={winTop ? zeroY - PAD.t : H - PAD.b - zeroY}
          fill="#10b981" opacity={0.06}
        />
        <text x={W - PAD.r - 2} y={winTop ? PAD.t + 9 : H - PAD.b - 3}
          textAnchor="end" className="fill-zinc-600" fontSize="8">
          {t.side} 胜区
        </text>
        {/* 0 线 = 开窗价 */}
        <line x1={PAD.l} x2={W - PAD.r} y1={zeroY} y2={zeroY}
          stroke="#52525b" strokeWidth="1" strokeDasharray="3 3" />
        {/* y 轴刻度 */}
        <text x={PAD.l - 4} y={PAD.t + 8} textAnchor="end" className="fill-zinc-500" fontSize="8">
          +{yMax.toFixed(1)}
        </text>
        <text x={PAD.l - 4} y={zeroY + 3} textAnchor="end" className="fill-zinc-500" fontSize="8">0</text>
        <text x={PAD.l - 4} y={H - PAD.b} textAnchor="end" className="fill-zinc-500" fontSize="8">
          −{yMax.toFixed(1)}
        </text>
        {/* x 轴刻度 */}
        {(zoom === "tail" ? [240, 270, 300] : [0, 100, 200, 300]).map((s) => (
          <text key={s} x={x(s)} y={H - 4} textAnchor="middle" className="fill-zinc-600" fontSize="8">
            {s}s
          </text>
        ))}
        {/* 位移轨迹 */}
        <polyline points={line} fill="none" stroke="#22d3ee" strokeWidth="1.6"
          strokeLinejoin="round" strokeLinecap="round" />
        {/* 买入点(仅当在缩放窗内) */}
        {entryPt && (
          <>
            <line x1={x(entryPt.s)} x2={x(entryPt.s)} y1={PAD.t} y2={H - PAD.b}
              stroke="#a1a1aa" strokeWidth="1" strokeDasharray="2 3" />
            <circle cx={x(entryPt.s)} cy={y(entryPt.disp)} r="4"
              fill="#22d3ee" stroke="#18181b" strokeWidth="1.5" />
            <text x={x(entryPt.s)} y={PAD.t + 8} textAnchor="middle" className="fill-zinc-400" fontSize="8">
              ▼买入 s{t.sEntry}
            </text>
          </>
        )}
        {/* 终点 */}
        <circle cx={x(last.s)} cy={y(last.disp)} r="3.5"
          fill={t.won ? "#34d399" : "#fb7185"} stroke="#18181b" strokeWidth="1.5" />
        {/* 悬停十字线 */}
        {hover && (
          <line x1={x(hover.s)} x2={x(hover.s)} y1={PAD.t} y2={H - PAD.b}
            stroke="#e4e4e7" strokeWidth="0.6" opacity={0.5} />
        )}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 rounded border border-zinc-700 bg-zinc-900/95 px-2 py-1 text-[10px] tabular-nums text-zinc-200 shadow-lg">
          s{hover.s} · 位移 {hover.disp > 0 ? "+" : ""}{hover.disp.toFixed(2)}bps
          {hover.bid != null && hover.ask != null && (
            <span className="text-zinc-400"> · {t.side}盘口 {hover.bid.toFixed(2)}/{hover.ask.toFixed(2)}</span>
          )}
        </div>
      )}
    </div>
  )
}

export function TradeReplayGrid({ trades, fileMissing }: { trades: ReplayTrade[]; fileMissing: boolean }) {
  const [zoom, setZoom] = useState<Zoom>("tail")
  if (trades.length === 0) {
    return (
      <p className="mt-3 text-xs text-zinc-500">
        {fileMissing
          ? "回放数据文件缺失（analysis/trades-viz.json,批次结束后由分析脚本生成）"
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
          线=Chainlink 相对开窗价位移(bps) · 淡绿=买入侧胜区 · 各图 y 轴独立 · 悬停看逐秒数值
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {trades.map((t, i) => (
          <div key={`${t.w}-${i}`} className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-2.5">
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="text-zinc-300 tabular-nums">
                {t.windowLabel}
                <span className={cn("ml-2", t.side === "Up" ? "text-emerald-300/90" : "text-rose-300/90")}>
                  {t.side}@{t.px.toFixed(2)}
                </span>
                <span className="ml-2 text-zinc-500">disp{t.dispEntry.toFixed(2)}bps</span>
                {t.matched < 5 && <span className="ml-1 text-zinc-500">({t.matched}股)</span>}
              </span>
              <span className={cn("font-semibold tabular-nums", t.won ? "text-emerald-400" : "text-rose-400")}>
                {t.won ? "胜" : "负"} {fmtUsd(t.pnl)}
              </span>
            </div>
            <MiniChart t={t} zoom={zoom} />
          </div>
        ))}
      </div>
    </div>
  )
}
