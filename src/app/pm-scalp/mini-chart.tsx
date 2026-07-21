"use client"

/**
 * 单窗偏离小图（btc-v1 范式）——从 real/replay.tsx 抽出的共享组件,行为逐字节保持:
 * 纵轴=BTC 相对开盘价偏离$（Chainlink 路径,决定输赢的那条线）;0 线=开盘价;
 * 淡绿半区=买入侧胜区;▼=买入时刻;终点圆点=结算(绿胜/红负/灰未成交);
 * 悬停十字线 + $偏离与 bps。y 轴各图独立(各窗偏离量级差异大)。
 * 消费面用结构化最小类型 ChartTradeLike——real 的 ReplayTrade 结构性满足,
 * paper 下钻的 API 响应同样满足,两边共用不互相耦合。
 */
import { useMemo, useState } from "react"

export interface ChartPoint {
  s: number
  dev: number
}

export interface ChartTradeLike {
  windowLabel: string
  side: "Up" | "Down"
  sEntry: number | null
  limit: number
  won: boolean | null
  pnl: number
  filled: boolean
  strike: number
  btc: ChartPoint[]
}

const W = 320
const H = 138
const PAD = { l: 34, r: 8, t: 8, b: 16 }

export type Zoom = "full" | "tail"

export function fmtUsd(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : ""
  return `${sign}$${Math.abs(n).toFixed(2)}`
}

// 紧凑 $ 偏离标签（y 轴用，量级大时省小数位）
function fmtDevAxis(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : ""
  const a = Math.abs(n)
  return `${sign}$${a >= 10 ? a.toFixed(0) : a.toFixed(1)}`
}

// bps 与 $ 同用 U+2212 负号，同一 tooltip 内字形一致
function fmtBps(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : ""
  return `${sign}${Math.abs(n).toFixed(2)}bps`
}

export function MiniChart({ t, zoom }: { t: ChartTradeLike; zoom: Zoom }) {
  const [hover, setHover] = useState<ChartPoint | null>(null)

  const { pts, x, y, ext, x0, x1 } = useMemo(() => {
    const x0 = zoom === "tail" ? 240 : 0
    const x1 = 300
    const pts = t.btc.filter((p) => p.s >= x0 && p.s <= x1)
    // y 轴对称 ±ext，保证 0 线（开盘价）居中；每图按可见数据独立取幅
    let ext = 2 // 最小 ±$2，防零位移窗压瘪/除零
    for (const p of pts) ext = Math.max(ext, Math.abs(p.dev))
    ext *= 1.15
    const x = (s: number) => PAD.l + ((s - x0) / (x1 - x0)) * (W - PAD.l - PAD.r)
    const y = (d: number) => PAD.t + ((ext - d) / (2 * ext)) * (H - PAD.t - PAD.b)
    return { pts, x, y, ext, x0, x1 }
  }, [t, zoom])

  if (pts.length < 4) {
    return <p className="text-xs text-zinc-500">该窗口 1Hz 轨迹缺失</p>
  }

  const line = pts
    .map((p) => `${x(p.s).toFixed(1)},${y(p.dev).toFixed(1)}`)
    .join(" ")
  const zeroY = y(0)
  const winTop = t.side === "Up" // Up 买家胜区在 0 线上方
  // 买入点在缩放窗之外时不画标记，避免钉在左缘误导
  const entryVisible = t.sEntry != null && t.sEntry >= x0 && t.sEntry <= x1
  const entryPt =
    entryVisible && t.sEntry != null
      ? pts.reduce((a, b) =>
          Math.abs(b.s - t.sEntry!) < Math.abs(a.s - t.sEntry!) ? b : a,
        )
      : null
  const last = pts[pts.length - 1]
  const hoverBps = hover && t.strike > 0 ? (hover.dev / t.strike) * 1e4 : null
  // 悬停数值三态色：在买入侧半区=绿 / 对侧=红 / 恰在 0 线=中性(不是亏损)
  const hoverTone =
    hover == null || hover.dev === 0
      ? "text-zinc-300"
      : hover.dev > 0 === winTop
        ? "text-emerald-400"
        : "text-rose-400"

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    // 反演比例尺要扣绘图区 padding，否则左缘偏移 ~PAD.l/W·span
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
        aria-label={`${t.windowLabel} ${t.side}@${t.limit} ${
          t.won == null ? "未成交" : t.won ? "胜" : "负"
        } ${fmtUsd(t.pnl)}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {/* 买入侧胜区淡绿（收窗时 BTC 停在这半区即赢） */}
        <rect
          x={PAD.l} width={W - PAD.l - PAD.r}
          y={winTop ? PAD.t : zeroY}
          height={winTop ? zeroY - PAD.t : H - PAD.b - zeroY}
          fill="#10b981" opacity={0.06}
        />
        {/* 胜区标签：Up 放左上——右上会与末秒买入点标签重叠(VN1 固定 s282/283 进场) */}
        <text
          x={winTop ? PAD.l + 3 : W - PAD.r - 2}
          y={winTop ? PAD.t + 9 : H - PAD.b - 3}
          textAnchor={winTop ? "start" : "end"}
          className="fill-zinc-600" fontSize="8"
        >
          {t.side} 胜区
        </text>
        {/* 0 线 = 开盘价 strike */}
        <line x1={PAD.l} x2={W - PAD.r} y1={zeroY} y2={zeroY}
          stroke="#52525b" strokeWidth="1" strokeDasharray="3 3" />
        {/* y 轴刻度 = ±$ 偏离 */}
        <text x={PAD.l - 4} y={PAD.t + 8} textAnchor="end"
          className="fill-zinc-500" fontSize="8">
          {fmtDevAxis(ext)}
        </text>
        <text x={PAD.l - 4} y={zeroY + 3} textAnchor="end"
          className="fill-zinc-500" fontSize="8">$0</text>
        <text x={PAD.l - 4} y={H - PAD.b} textAnchor="end"
          className="fill-zinc-500" fontSize="8">
          {fmtDevAxis(-ext)}
        </text>
        {/* x 轴刻度 */}
        {(zoom === "tail" ? [240, 270, 300] : [0, 100, 200, 300]).map((s) => (
          <text key={s} x={x(s)} y={H - 4} textAnchor="middle"
            className="fill-zinc-600" fontSize="8">
            {s}s
          </text>
        ))}
        {/* BTC 偏离轨迹（客观数据，成交与否同色；成交状态看终点/标记/badge） */}
        <polyline points={line} fill="none" stroke="#22d3ee" strokeWidth="1.4"
          strokeLinejoin="round" strokeLinecap="round" />
        {/* 买入点（标在当秒偏离线上） */}
        {entryPt && (
          <>
            <line x1={x(entryPt.s)} x2={x(entryPt.s)} y1={PAD.t} y2={H - PAD.b}
              stroke="#a1a1aa" strokeWidth="1" strokeDasharray="2 3" />
            <circle cx={x(entryPt.s)} cy={y(entryPt.dev)} r="4"
              fill={t.filled ? "#22d3ee" : "#71717a"} stroke="#18181b"
              strokeWidth="1.5" />
            {/* 标签贴近左右边缘时换锚点防溢出 */}
            <text
              x={x(entryPt.s)} y={PAD.t + 8}
              textAnchor={
                x(entryPt.s) > W - PAD.r - 40
                  ? "end"
                  : x(entryPt.s) < PAD.l + 40
                    ? "start"
                    : "middle"
              }
              className="fill-zinc-400" fontSize="8"
            >
              ▼{t.filled ? "买" : "挂"}@{t.limit.toFixed(2)}
            </text>
          </>
        )}
        {/* 终点 = 结算结果 */}
        <circle cx={x(last.s)} cy={y(last.dev)} r="3.5"
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
          s{hover.s} · 偏离{" "}
          <span className={hoverTone}>{fmtUsd(hover.dev)}</span>
          {hoverBps != null && (
            <span className="text-zinc-500"> ({fmtBps(hoverBps)})</span>
          )}
        </div>
      )}
    </div>
  )
}
