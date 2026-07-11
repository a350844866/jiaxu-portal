import Link from "next/link"
import {
  readPmScalpRealSnapshot,
  type PmScalpRealSnapshot,
  type RealTradeRow,
} from "@/lib/pm-scalp-real-reader"
import { PmScalpTabs } from "../tabs"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"

function ageText(sec: number | null): string {
  if (sec == null) return "—"
  if (sec < 60) return `${sec}s 前`
  if (sec < 3600) return `${Math.floor(sec / 60)}min 前`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h 前`
  return `${Math.floor(sec / 86400)}d 前`
}

function fmtUsd(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—"
  const sign = n > 0 ? "+" : ""
  return `${sign}$${n.toFixed(digits)}`
}

function pnlClass(n: number | null | undefined): string {
  if (n == null) return "text-zinc-300"
  return n > 0 ? "text-emerald-400" : n < 0 ? "text-rose-400" : "text-zinc-300"
}

const STATUS_META: Record<RealTradeRow["status"], { label: string; cls: string }> = {
  pending: { label: "待结算", cls: "text-zinc-400" },
  won: { label: "胜", cls: "text-emerald-400" },
  lost: { label: "负", cls: "text-rose-400" },
  nofill: { label: "未成交", cls: "text-zinc-500" },
  unresolved: { label: "⚠ 未决", cls: "text-amber-400" },
  uncertain: { label: "⚠ 证据不全", cls: "text-amber-400" },
}

function SimBadge({ r }: { r: RealTradeRow }) {
  if (r.sim.kind === "era-mismatch")
    return <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">v2时代·不可比</span>
  if (r.sim.kind === "none")
    return <span className="text-[10px] text-zinc-600">无记录</span>
  if (r.sim.kind === "miss")
    return (
      <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-300">
        模拟miss({r.sim.missReason})
      </span>
    )
  // entry
  // uncertain 时价差是拿挂价退化比较的, 前缀 ~ 明示口径
  const approx = r.status === "uncertain" ? "~" : ""
  if (r.simDivergence === "side-mismatch")
    return <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">方向背离</span>
  if (r.simDivergence === "px-gap")
    return (
      <span className="rounded bg-yellow-500/15 px-1.5 py-0.5 text-[10px] text-yellow-300">
        {approx}价差 模拟{r.sim.px?.toFixed(2)}
      </span>
    )
  if (r.simDivergence === "match")
    return (
      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
        {approx}贴合 {r.sim.px?.toFixed(2)}
      </span>
    )
  return <span className="text-[10px] text-zinc-500">模拟 {r.sim.px?.toFixed(2)}</span>
}

/**
 * 已实现权益折线（单序列 · 无图例 · 2px 线 · recessive 网格 · 原生 title hover）。
 * 边界:0 点→占位文案;1 点/全平→中线呈现,杜绝 NaN 坐标。
 */
function EquityCurve({ snap }: { snap: PmScalpRealSnapshot }) {
  const pts = snap.equity
  const W = 640
  const H = 150
  const PAD = { l: 46, r: 14, t: 12, b: 20 }

  if (pts.length === 0)
    return <p className="mt-3 text-xs text-zinc-500">暂无账本数据</p>

  const t0 = pts[0].ts
  // 时间域并入批次锚点: starts 不产生权益点, 但分界线必须落在图内
  const t1 = Math.max(pts[pts.length - 1].ts, snap.batch?.anchorTs ?? -Infinity)
  const tSpan = Math.max(1, t1 - t0)
  const vals = pts.map((p) => p.balance)
  let lo = Math.min(...vals)
  let hi = Math.max(...vals)
  if (hi - lo < 0.5) {
    // 全平/近平序列: 撑开一个固定带宽避免除零与假波动
    const mid = (hi + lo) / 2
    lo = mid - 0.5
    hi = mid + 0.5
  }
  const x = (ts: number) => PAD.l + ((ts - t0) / tSpan) * (W - PAD.l - PAD.r)
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b)

  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.ts).toFixed(1)},${y(p.balance).toFixed(1)}`).join(" ")
  const anchorY = y(snap.balanceStart)
  const batchX =
    snap.batch && snap.batch.anchorTs >= t0 && snap.batch.anchorTs <= t1
      ? x(snap.batch.anchorTs)
      : null
  const last = pts[pts.length - 1]
  const fmtT = (ts: number) =>
    new Date(ts * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })

  return (
    <div className="mt-3 overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[560px] w-full" role="img" aria-label="实盘已实现权益曲线">
        {/* recessive 网格: 上下界 + 锚点参考线 */}
        {[lo, hi].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="#3f3f46" strokeWidth="0.5" strokeDasharray="2 4" />
            <text x={PAD.l - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill="#71717a">${v.toFixed(1)}</text>
          </g>
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={anchorY} y2={anchorY} stroke="#52525b" strokeWidth="1" strokeDasharray="4 4" />
        <text x={W - PAD.r} y={anchorY - 4} textAnchor="end" fontSize="9" fill="#a1a1aa">起点 ${snap.balanceStart.toFixed(2)}</text>
        {/* 批次分界 */}
        {batchX != null && (
          <g>
            <line x1={batchX} x2={batchX} y1={PAD.t} y2={H - PAD.b} stroke="#52525b" strokeWidth="1" strokeDasharray="3 3" />
            <text x={batchX + 4} y={PAD.t + 8} fontSize="9" fill="#a1a1aa">50单批</text>
          </g>
        )}
        {/* 主线 */}
        <path d={d} fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {/* 点位 + 原生 tooltip(hit 目标 8px) */}
        {pts.map((p, i) => (
          <circle key={i} cx={x(p.ts)} cy={y(p.balance)} r="8" fill="transparent" className="cursor-default">
            <title>{`${fmtT(p.ts)} · $${p.balance.toFixed(4)}`}</title>
          </circle>
        ))}
        {pts.map((p, i) => (
          <circle key={`v${i}`} cx={x(p.ts)} cy={y(p.balance)} r="2" fill="#22d3ee" />
        ))}
        {/* 端点直标 */}
        <text
          x={Math.min(x(last.ts), W - PAD.r - 2)}
          y={Math.max(PAD.t + 8, y(last.balance) - 8)}
          textAnchor="end"
          fontSize="10"
          fontWeight="600"
          fill="#e4e4e7"
        >
          ${last.balance.toFixed(2)}
        </text>
      </svg>
    </div>
  )
}

export default async function PmScalpRealPage() {
  const snap = await readPmScalpRealSnapshot()
  const settled = snap.wins + snap.losses
  const winrate = settled > 0 ? `${((snap.wins / settled) * 100).toFixed(0)}%` : "—"
  const liveFresh = snap.running && snap.lastEventAgeSeconds != null && snap.lastEventAgeSeconds < 3600

  return (
    <main className="relative min-h-screen space-y-6 bg-zinc-950 p-4 sm:p-6 lg:p-8">
      {/* 氛围光晕: 琥珀(真金)+青, 与模拟页同语言但主色区分 */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 left-[18%] h-96 w-96 rounded-full bg-amber-500/[0.05] blur-3xl" />
        <div className="absolute top-1/2 right-[10%] h-[28rem] w-[28rem] rounded-full bg-cyan-500/[0.04] blur-3xl" />
      </div>

      <header className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-xl font-bold text-zinc-50">pm-scalp 实盘</h1>
          <span className="text-xs text-zinc-500">
            Polymarket 真实账户 · N4 末段噪声回归 · 真金执行
          </span>
          <Link href="/" className="ml-auto text-xs text-zinc-500 hover:text-zinc-300">← 返回首页</Link>
        </div>
        <PmScalpTabs active="real" />
      </header>

      {snap.alarms.length > 0 && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          ⚠ 账本告警:{snap.alarms.slice(0, 6).join(" · ")}
          {snap.alarms.length > 6 && ` · 等 ${snap.alarms.length} 条`}
        </div>
      )}

      {/* 状态条 */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <span className={cn("inline-block h-2 w-2 rounded-full", liveFresh ? "animate-pulse bg-emerald-500" : snap.running ? "bg-amber-500" : "bg-zinc-600")} />
            recon 执行器
          </div>
          <div className="mt-1 text-sm font-semibold text-zinc-200">
            {snap.running ? "运行中" : "已停止"}
          </div>
          <div className="text-[11px] text-zinc-500">最后账本事件 {ageText(snap.lastEventAgeSeconds)}</div>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="text-[11px] text-zinc-500">本批进度(50 单累计批)</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-sm font-semibold tabular-nums text-zinc-200">
              {snap.batch ? `${snap.batch.done} / ${snap.batch.denominator}` : "—"}
            </span>
            <span className="text-xs text-zinc-500">在途 {snap.batch?.pending ?? 0}</span>
          </div>
          {snap.batch && snap.batch.denominator > 0 && (
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-cyan-500/70"
                style={{ width: `${Math.min(100, (snap.batch.done / snap.batch.denominator) * 100)}%` }}
              />
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="text-[11px] text-zinc-500">已实现权益(起点 ${snap.balanceStart.toFixed(2)})</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-sm font-semibold tabular-nums text-zinc-100">${snap.realizedEquity.toFixed(2)}</span>
            <span className={cn("text-xs font-semibold tabular-nums", pnlClass(snap.netTotal))}>{fmtUsd(snap.netTotal)}</span>
          </div>
          <div className="text-[11px] text-zinc-500">
            在途占用 ~${snap.openCostBound.toFixed(2)}
            {snap.uncertainCount > 0 && <span className="text-amber-400"> · ⚠ {snap.uncertainCount} 单证据不全未计入</span>}
          </div>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="text-[11px] text-zinc-500">战绩({settled} 单已定 · 含费净额口径)</div>
          <div className="mt-1 text-sm font-semibold tabular-nums text-zinc-200">
            {snap.wins}胜{snap.losses}负 · {winrate}
          </div>
          <div className="text-[11px] text-zinc-500">
            maker 成交占比 {snap.makerLotRatio == null ? "—" : `${(snap.makerLotRatio * 100).toFixed(0)}%`}(零费)
            {snap.nofills > 0 && ` · 未成交 ${snap.nofills}`}
          </div>
        </div>
      </section>

      {/* 权益曲线 */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h2 className="text-sm font-medium text-zinc-200">
          已实现权益曲线
          <span className="ml-2 text-xs font-normal text-zinc-500">
            每个终态结算落一点 · 已 7 单逐单对平链上余额的口径 · 不含在途持仓估值
          </span>
        </h2>
        <EquityCurve snap={snap} />
      </section>

      {/* 逐单表 */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h2 className="text-sm font-medium text-zinc-200">
          逐单明细<span className="ml-2 text-xs font-normal text-zinc-500">全部实盘单 · 5 股/单 · 净额=实际成交价+实收费</span>
        </h2>
        {snap.trades.length === 0 ? (
          <p className="mt-3 text-xs text-zinc-500">还没有实盘交易</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-zinc-500">
                  <th className="py-1.5 pr-3 font-normal">窗口(+08)</th>
                  <th className="py-1.5 pr-3 font-normal">买入侧</th>
                  <th className="py-1.5 pr-3 text-right font-normal">挂价</th>
                  <th className="py-1.5 pr-3 text-right font-normal">成交均价</th>
                  <th className="py-1.5 pr-3 text-right font-normal">费</th>
                  <th className="py-1.5 pr-3 text-right font-normal">状态</th>
                  <th className="py-1.5 pr-3 text-right font-normal">净额</th>
                  <th className="py-1.5 font-normal">模拟盘 N4 同窗</th>
                </tr>
              </thead>
              <tbody>
                {snap.trades.map((r) => (
                  <tr key={r.oid10} className="border-b border-zinc-800/50 last:border-0">
                    <td className="py-1.5 pr-3 tabular-nums text-zinc-300">{r.windowLabel}</td>
                    <td className={cn("py-1.5 pr-3", r.sideUp ? "text-emerald-300/90" : "text-rose-300/90")}>
                      {r.sideUp ? "Up" : "Down"}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-400">{r.limitPx.toFixed(2)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-200">
                      {r.fillPxAvg == null ? "—" : r.fillPxAvg.toFixed(r.fillPxAvg < 0.05 ? 3 : 2)}
                      {r.makerRatio != null && r.makerRatio > 0 && (
                        <span className="ml-1 rounded bg-cyan-500/15 px-1 py-0.5 text-[9px] text-cyan-300">maker</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-400">
                      {r.fee == null ? "—" : r.fee === 0 ? "0" : r.fee.toFixed(3)}
                    </td>
                    <td className={cn("py-1.5 pr-3 text-right", STATUS_META[r.status].cls)}>
                      {STATUS_META[r.status].label}
                    </td>
                    <td className={cn("py-1.5 pr-3 text-right font-semibold tabular-nums", pnlClass(r.netPnl))}>
                      {fmtUsd(r.netPnl)}
                    </td>
                    <td className="py-1.5">
                      <SimBadge r={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="pb-4 text-center text-[11px] text-zinc-600">
        数据:家服 /data/pm-scalp/real(recon 真金账本,只读) · 净额口径=实际成交价+实收费(maker 零费/taker 7%·p(1−p)),已逐单对平链上余额 ·
        recon 自身日志的毛口径(按挂价、不含费)会与本页略有出入
      </footer>
    </main>
  )
}
