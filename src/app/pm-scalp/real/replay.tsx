"use client"

/**
 * 真金交易回放（btc-v1）：每笔单一张小倍数图，纵轴=**BTC 相对开盘价的偏离（美元）**
 * ——Chainlink（结算源）路径，决定这笔单输赢的那条线。0 线=开盘价(strike)；
 * 淡绿半区=买入侧胜区（收窗时 BTC 停在该半区即赢：Up 在 0 线上方、Down 在下方）；
 * ▼=买入时刻（标在当秒偏离线上）；终点圆点=结算结果（绿胜/红负/灰未成交）。
 * 悬停出十字线 + 该秒 $ 偏离与 bps(=dev/strike×1e4)。
 * 注意：胜负以交易所结算 oracle 为准；本线是 1Hz 采样（末点 s=299），
 * 极限窗（末秒塌到 0 附近）线尾与结算 round 可能差毫厘。
 * y 轴各图独立（各窗偏离量级差异大，统一轴会压平小位移窗）。
 * 数据每 5 分钟自增再生(gen_trades_viz.py)，滚动最近 20 笔。
 */
import { useMemo, useState } from "react"
import type { ReplayTrade, ReplayPoint } from "@/lib/pm-scalp-replay-reader"
import { cn } from "@/lib/utils"

const W = 320
const H = 138
const PAD = { l: 34, r: 8, t: 8, b: 16 }

type Zoom = "full" | "tail"

function fmtUsd(n: number): string {
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

function MiniChart({ t, zoom }: { t: ReplayTrade; zoom: Zoom }) {
  const [hover, setHover] = useState<ReplayPoint | null>(null)

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
          线=BTC(Chainlink)相对开盘价的偏离$ · 0线=开盘价 · 淡绿=买入侧胜区 ·
          各图y轴独立 · 悬停看$与bps · 胜负以交易所结算为准(线为1Hz采样)
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {trades.map((t) => (
          <div
            key={t.oid ?? String(t.w)}
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
            {/* key=zoom：切换缩放时重挂载清空悬停态，防过期十字线/tooltip 指向不可见秒 */}
            <MiniChart key={zoom} t={t} zoom={zoom} />
          </div>
        ))}
      </div>
    </div>
  )
}
