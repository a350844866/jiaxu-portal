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
import { useState } from "react"
import type { ReplayTrade } from "@/lib/pm-scalp-replay-reader"
import { cn } from "@/lib/utils"
import { MiniChart, fmtUsd, type Zoom } from "../mini-chart"

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
          各图y轴独立 · 悬停看$与bps · 金额=费后(taker费上界) · 胜负以交易所结算为准(线为1Hz采样)
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
