import Link from "next/link"
import { readPmScalpSnapshot, type PmScalpTradeRow, type PmScalpVariantStat } from "@/lib/pm-scalp-reader"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"

function ageText(sec: number | null): string {
  if (sec == null) return "—"
  if (sec < 60) return `${sec}s 前`
  if (sec < 3600) return `${Math.floor(sec / 60)}min 前`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h 前`
  return `${Math.floor(sec / 86400)}d 前`
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—"
  const sign = n > 0 ? "+" : ""
  return `${sign}$${n.toFixed(2)}`
}

function pnlClass(n: number | null | undefined): string {
  if (n == null) return "text-zinc-300"
  return n > 0 ? "text-emerald-400" : n < 0 ? "text-rose-400" : "text-zinc-300"
}

function FreshDot({ sec, staleAfter }: { sec: number | null; staleAfter: number }) {
  const cls =
    sec == null
      ? "bg-zinc-600"
      : sec <= staleAfter
        ? "bg-emerald-500"
        : sec <= staleAfter * 4
          ? "bg-amber-500"
          : "bg-rose-500"
  return <span className={cn("inline-block h-2 w-2 rounded-full", cls)} />
}

function VariantTable({ variants }: { variants: PmScalpVariantStat[] }) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
      <h2 className="text-sm font-medium text-zinc-200">六变体战绩(虚拟 $100/笔,P1 $10)</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] text-xs">
          <thead>
            <tr className="border-b border-zinc-800 text-left text-zinc-500">
              <th className="py-1.5 pr-3 font-normal">变体</th>
              <th className="py-1.5 pr-3 font-normal">策略</th>
              <th className="py-1.5 pr-3 text-right font-normal">已结算</th>
              <th className="py-1.5 pr-3 text-right font-normal">胜率</th>
              <th className="py-1.5 pr-3 text-right font-normal">P&amp;L</th>
              <th className="py-1.5 pr-3 text-right font-normal">均值/笔</th>
              <th className="py-1.5 text-right font-normal">持仓中</th>
            </tr>
          </thead>
          <tbody>
            {variants.map((v) => (
              <tr key={v.id} className="border-b border-zinc-800/50 last:border-0">
                <td className="py-1.5 pr-3 font-mono text-zinc-200">{v.id}</td>
                <td className="py-1.5 pr-3 text-zinc-400">
                  {v.label}
                  <span className="ml-1.5 text-zinc-600">{v.mode}</span>
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-300">{v.settled}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-300">
                  {v.winrate == null ? "—" : `${(v.winrate * 100).toFixed(0)}%`}
                </td>
                <td className={cn("py-1.5 pr-3 text-right font-semibold tabular-nums", pnlClass(v.pnl))}>
                  {fmtUsd(v.pnl)}
                </td>
                <td className={cn("py-1.5 pr-3 text-right tabular-nums", pnlClass(v.avgPerTrade))}>
                  {fmtUsd(v.avgPerTrade)}
                </td>
                <td className="py-1.5 text-right tabular-nums text-zinc-300">{v.open || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function TradesTable({ title, rows, empty }: { title: string; rows: PmScalpTradeRow[]; empty: string }) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
      <h2 className="text-sm font-medium text-zinc-200">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-zinc-500">{empty}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-zinc-500">
                <th className="py-1.5 pr-3 font-normal">窗口(+08)</th>
                <th className="py-1.5 pr-3 font-normal">变体</th>
                <th className="py-1.5 pr-3 font-normal">买入侧</th>
                <th className="py-1.5 pr-3 text-right font-normal">价格</th>
                <th className="py-1.5 pr-3 text-right font-normal">位移bps</th>
                <th className="py-1.5 pr-3 text-right font-normal">入场秒</th>
                <th className="py-1.5 text-right font-normal">结果</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.w}:${r.v}`} className="border-b border-zinc-800/50 last:border-0">
                  <td className="py-1.5 pr-3 tabular-nums text-zinc-300">{r.windowLabel}</td>
                  <td className="py-1.5 pr-3 font-mono text-zinc-300">{r.v}</td>
                  <td className={cn("py-1.5 pr-3", r.sideUp ? "text-emerald-300/90" : "text-rose-300/90")}>
                    {r.sideUp ? "Up" : "Down"}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-300">{r.px.toFixed(r.px < 0.05 ? 3 : 2)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-400">
                    {r.disp == null ? "—" : r.disp.toFixed(1)}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-400">{r.s ?? "—"}</td>
                  <td className={cn("py-1.5 text-right font-semibold tabular-nums", pnlClass(r.pnl))}>
                    {r.won == null ? "待结算" : `${r.won ? "胜" : "负"} ${fmtUsd(r.pnl)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default async function PmScalpPage() {
  const snap = await readPmScalpSnapshot()
  const winrate = snap.totals.settled > 0 ? snap.totals.wins / snap.totals.settled : null

  return (
    <main className="relative min-h-screen space-y-6 bg-zinc-950 p-4 sm:p-6 lg:p-8">
      {/* 氛围光晕:青(秒级数据流)+ 紫(微结构),与 pm-paper/serenity 看板同语言 */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 left-[18%] h-96 w-96 rounded-full bg-cyan-500/[0.05] blur-3xl" />
        <div className="absolute top-1/2 right-[10%] h-[28rem] w-[28rem] rounded-full bg-violet-500/[0.04] blur-3xl" />
      </div>

      <header className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-xl font-bold text-zinc-50">pm-scalp 微结构实验</h1>
          <span className="text-xs text-zinc-500">
            BTC 5min 涨跌盘 · 末段噪声回归 forward test · 判定日 {snap.judgmentDate}
          </span>
          <Link href="/" className="ml-auto text-xs text-zinc-500 hover:text-zinc-300">← 返回首页</Link>
        </div>
        <p className="max-w-3xl text-sm leading-6 text-zinc-400">
          验证钱包法证发现的 top 赢家打法:窗口最后 60-110 秒、Chainlink 位移可忽略时买入被砸的落后侧。
          决策只用 Polymarket 结算同源的 Chainlink 流(cl-only),币安仅作基差观测。全部虚拟资金。
        </p>
      </header>

      {/* 健康与总览条 */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <FreshDot sec={snap.dataAgeSeconds} staleAfter={15} /> 记录器数据流
          </div>
          <div className="mt-1 text-sm font-semibold text-zinc-200">{ageText(snap.dataAgeSeconds)}</div>
          <div className="text-[11px] text-zinc-500">已覆盖 {snap.windowsRecorded} 个窗口</div>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <FreshDot sec={snap.heartbeatAgeSeconds} staleAfter={45} /> 模拟执行器心跳
          </div>
          <div className="mt-1 text-sm font-semibold text-zinc-200">{ageText(snap.heartbeatAgeSeconds)}</div>
          <div className="text-[11px] text-zinc-500">watchdog 每 5min 保活</div>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="text-[11px] text-zinc-500">总 P&amp;L({snap.totals.settled} 笔已结算)</div>
          <div className={cn("mt-1 text-sm font-semibold tabular-nums", pnlClass(snap.totals.pnl))}>
            {fmtUsd(snap.totals.pnl)}
          </div>
          <div className="text-[11px] text-zinc-500">
            胜率 {winrate == null ? "—" : `${(winrate * 100).toFixed(0)}%`} · 持仓 {snap.totals.open}
          </div>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="text-[11px] text-zinc-500">Chainlink vs 币安基差(实时观测)</div>
          <div className="mt-1 text-sm font-semibold tabular-nums text-zinc-200">
            {snap.basis ? `$${snap.basis.usd.toFixed(0)} · ${snap.basis.bps.toFixed(1)}bps` : "—"}
          </div>
          <div className="text-[11px] text-zinc-500">
            {snap.basis ? `cl ${snap.basis.cl.toFixed(0)} / bn ${snap.basis.btc.toFixed(0)}` : "等待数据"}
          </div>
        </div>
      </section>

      <VariantTable variants={snap.variants} />

      <TradesTable
        title="持仓中(等待窗口结算)"
        rows={snap.openEntries}
        empty="当前无持仓 — 只在每窗最后 60-110 秒条件命中时开仓,空仓是常态"
      />
      <TradesTable
        title="最近结算(最新 20 笔)"
        rows={snap.recentTrades}
        empty={`还没有已结算交易 — 干净账本自 ${snap.ledgerSince} 起从零累积`}
      />

      <footer className="pb-4 text-center text-[11px] text-zinc-600">
        数据:家服 /data/pm-scalp(recorder 秒级采集 + papertrader 模拟执行)· 账本 {snap.ledgerSince} · 仅模拟研究,非投资建议
      </footer>
    </main>
  )
}
