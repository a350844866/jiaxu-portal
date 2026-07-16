import Link from "next/link"
import { readPmScalpSnapshot, type PmScalpTradeRow, type PmScalpVariantStat } from "@/lib/pm-scalp-reader"
import { readHonestScorecard, type HonestVariant } from "@/lib/pm-scalp-honest-reader"
import { PmScalpTabs } from "./tabs"
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

function fmtPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—"
  const sign = n > 0 ? "+" : ""
  return `${sign}${(n * 100).toFixed(1)}%`
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
  // 只按当前诚实模型(CURRENT_EXEC=5,tick 级关窗回放)口径展示。
  // 更早模型的账已归档出主账本(trades-pre-v5-archive 等),遗留混入仅页尾灰字追溯。
  // (字段名 v3 是历史命名,语义 = 当前模型切片)
  const rows = [...variants].sort((a, b) => b.v3.pnl - a.v3.pnl)
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
      <h2 className="text-sm font-medium text-zinc-200">
        变体战绩
        <span className="ml-2 rounded bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-medium text-cyan-300">v5 tick 纪元</span>
        <span className="ml-2 text-xs font-normal text-zinc-500">
          每笔 5 股 · 1500ms 悲观 · <span className="text-amber-300/80">仅平静窗口径(互证拒用窗未计)</span> · 诚实全窗见下表
        </span>
      </h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] text-xs">
          <thead>
            <tr className="border-b border-zinc-800 text-left text-zinc-500">
              <th className="py-1.5 pr-3 font-normal">变体</th>
              <th className="py-1.5 pr-3 font-normal">策略</th>
              <th className="py-1.5 pr-3 text-right font-normal">已结算</th>
              <th className="py-1.5 pr-3 text-right font-normal">胜率</th>
              <th className="py-1.5 pr-3 text-right font-normal">P&amp;L</th>
              <th className="py-1.5 pr-3 text-right font-normal">盈利率</th>
              <th className="py-1.5 pr-3 text-right font-normal">均值/笔</th>
              <th className="py-1.5 text-right font-normal">持仓中</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id} className="border-b border-zinc-800/50 last:border-0">
                <td className="py-1.5 pr-3 font-mono text-zinc-200">{v.id}</td>
                <td className="py-1.5 pr-3 text-zinc-400">
                  {v.label}
                  <span className="ml-1.5 text-zinc-600">{v.mode}</span>
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-300">{v.v3.settled || "—"}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-300">
                  {v.v3.winrate == null ? "—" : `${(v.v3.winrate * 100).toFixed(0)}%`}
                </td>
                <td className={cn("py-1.5 pr-3 text-right font-semibold tabular-nums", pnlClass(v.v3.settled ? v.v3.pnl : null))}>
                  {v.v3.settled ? fmtUsd(v.v3.pnl) : "—"}
                </td>
                <td className={cn("py-1.5 pr-3 text-right tabular-nums", pnlClass(v.v3.roiOnCost))}>
                  {v.v3.settled ? fmtPct(v.v3.roiOnCost) : "—"}
                </td>
                <td className={cn("py-1.5 pr-3 text-right tabular-nums", pnlClass(v.v3.avgPerTrade))}>
                  {v.v3.settled ? fmtUsd(v.v3.avgPerTrade) : "—"}
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

function HonestScorecard({
  variants,
  generated,
  fileMissing,
}: {
  variants: HonestVariant[]
  generated: string
  fileMissing: boolean
}) {
  return (
    <section className="rounded-2xl border border-amber-900/40 bg-amber-950/[0.08] p-4">
      <h2 className="text-sm font-medium text-zinc-200">
        诚实全窗口口径
        <span className="ml-2 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
          去水分
        </span>
        <span className="ml-2 text-xs font-normal text-zinc-500">
          模拟盘互证拒用了约半数窗口(快市/震荡)→ 平静窗成绩是海市蜃楼。
          此处把拒用/未成窗按<span className="text-zinc-300">真实收盘结果</span>补回,
          即真金无法跳窗时的实况
          {generated && ` · 更新于 ${generated}`}
        </span>
      </h2>
      {variants.length === 0 ? (
        <p className="mt-3 text-xs text-zinc-500">
          {fileMissing
            ? "记分板文件缺失(analysis/honest-scorecard.json,gen_honest_scorecard.py 每 10min 再生)"
            : "记分板暂无可展示变体"}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-zinc-500">
                <th className="py-1.5 pr-3 font-normal">变体</th>
                <th className="py-1.5 pr-3 text-right font-normal">平静窗(海市蜃楼)</th>
                <th className="py-1.5 pr-3 text-right font-normal">全窗口 胜率</th>
                <th className="py-1.5 pr-3 text-right font-normal">全窗 P&L(fr=1 / 成交率)</th>
                <th className="py-1.5 font-normal">分日(regime)</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((v) => {
                const flip =
                  v.calm.pnl > 0 && v.allWindow.pnlOpt <= 0 // 平静赚→全窗亏 = 铁证海市蜃楼
                return (
                  <tr key={v.v} className="border-b border-zinc-800/50 last:border-0 align-top">
                    <td className="py-2 pr-3 font-mono text-zinc-200">
                      {v.v}
                      {flip && (
                        <span className="ml-1.5 rounded bg-rose-500/15 px-1 py-px text-[9px] text-rose-300">
                          海市蜃楼
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      <span className={pnlClass(v.calm.pnl)}>{fmtUsd(v.calm.pnl)}</span>
                      <span className="ml-1 text-zinc-600">
                        {v.calm.n}单 {v.calm.winrate == null ? "—" : `${(v.calm.winrate * 100).toFixed(0)}%`}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-zinc-300">
                      {v.allWindow.winrate == null ? "—" : `${(v.allWindow.winrate * 100).toFixed(0)}%`}
                      <span className="ml-1 text-zinc-600">{v.allWindow.n}单</span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      <span className={cn("font-semibold", pnlClass(v.allWindow.pnlOpt))}>
                        {fmtUsd(v.allWindow.pnlOpt)}
                      </span>
                      <span className="text-zinc-600"> / </span>
                      <span className={pnlClass(v.allWindow.pnlFill)}>{fmtUsd(v.allWindow.pnlFill)}</span>
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                        {v.byDay.map((d) => (
                          <span key={d.day} className="tabular-nums text-[11px] text-zinc-500">
                            {d.day.slice(3)}
                            <span className={cn("ml-0.5", pnlClass(d.pnl))}>{fmtUsd(d.pnl)}</span>
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] leading-5 text-zinc-500">
            fr=1=假设每个信号都按限价成交(上界)；成交率=按 C1 真金分侧分价位成交率折算(下界,但仍未计
            <span className="text-zinc-400">成交毒性</span>——亏单比赢单更容易成交,故真实更差)。
            <span className="text-amber-300/80">注意分日:C1 系全窗账面即便为正,利润也几乎全压在单一趋势日,混合/震荡日≈零或负</span>——
            与真金 VN1 净亏同构。真相以真金账本为准。
          </p>
        </div>
      )}
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
  const honest = await readHonestScorecard()
  const v3Winrate = snap.totalsV3.settled > 0 ? snap.totalsV3.wins / snap.totalsV3.settled : null
  // 全时代累计(含已废弃执行模型) — 仅页尾灰字追溯,不作决策口径
  const legacyPnl = snap.totals.pnl - snap.totalsV3.pnl
  const legacySettled = snap.totals.settled - snap.totalsV3.settled

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
        <PmScalpTabs active="paper" />
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
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            总盈亏 ÷ 累计投入
            <span className="rounded bg-cyan-500/10 px-1 py-px text-[9px] font-medium text-cyan-300">v5</span>
            <span>({snap.totalsV3.settled} 笔)</span>
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className={cn("text-sm font-semibold tabular-nums", pnlClass(snap.totalsV3.settled ? snap.totalsV3.pnl : null))}>
              {snap.totalsV3.settled ? fmtUsd(snap.totalsV3.pnl) : "—"}
            </span>
            <span className="text-xs tabular-nums text-zinc-500">/ ${snap.totalsV3.settledCost.toFixed(0)} 流水</span>
          </div>
          <div className="text-[11px] text-zinc-500">
            <span className={cn("font-semibold", pnlClass(snap.totalsV3.roiOnCost))}>盈利率 {fmtPct(snap.totalsV3.roiOnCost)}</span>
            (每 $1 投入)· 胜率 {v3Winrate == null ? "—" : `${(v3Winrate * 100).toFixed(0)}%`} · 持仓 {snap.totals.open}
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

      <p className="rounded-xl border border-cyan-800/40 bg-cyan-950/20 px-3 py-2 text-[11px] leading-5 text-zinc-400">
        <span className="font-medium text-cyan-300">口径:v5 tick 纪元(exec=5,2026-07-13 起,tick 级关窗回放)。</span>
        成交判定 = 全量订单簿重建 + marketable-limit 生命周期(到达走簿→3s 静置悲观队列→撤单)+ 延迟竞速(headline 1500ms,300/800ms 敏感档另记);
        tape×tick 双采集互证 fail-closed,不可信窗整窗拒记。变体池仅 4 幸存者(C1 家族/VN1/B1S),定义冻结于 SPEC-ticksim-v5。
        更早模型(exec≤4,papertrader 已退役)的账<span className="text-zinc-300">已整体归档出主账本</span>,对实盘判断无参考价值。判定日 {snap.judgmentDate} 主判 C1 真金,v5 前向为参考。
      </p>

      <p className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-3 py-2 text-[11px] leading-5 text-zinc-500">
        <span className="text-zinc-400">资金口径:</span>没有固定本金池——每笔独立投入 5 股(约 $2.5-5,对齐真金执行器规格),含买入成本与 taker 手续费(maker 部分零费),持有到窗口结算,不复利。
        「累计投入」是<span className="text-zinc-400">流水</span>而非占用资金。
        <span className="text-zinc-400">盈利率 = 累计盈亏 ÷ 累计投入</span>,即按投入加权的单笔平均收益率(每投入 $1 平均赚回多少),不是「账户本金涨幅」。
        样本注意:多个变体常在同一窗口开仓,盈亏高度相关,有效样本按独立窗口数看。
      </p>

      <VariantTable variants={snap.variants} />

      <HonestScorecard
        variants={honest.variants}
        generated={honest.generated}
        fileMissing={honest.fileMissing}
      />

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

      {legacySettled > 0 && (
        <p className="text-center text-[11px] text-zinc-600">
          追溯(不作决策口径):主账本内含 {legacySettled} 笔旧执行模型交易(归档遗留),
          单独贡献 <span className={pnlClass(legacyPnl)}>{fmtUsd(legacyPnl)}</span>;
          该口径乐观虚高、与实盘不可比,仅存档。全时代合计 {snap.totals.settled} 笔 {fmtUsd(snap.totals.pnl)}。
        </p>
      )}

      <footer className="pb-4 text-center text-[11px] text-zinc-600">
        数据:家服 /data/pm-scalp(recorder 秒级采集 + papertrader 模拟执行)· 账本 {snap.ledgerSince} · 仅模拟研究,非投资建议
      </footer>
    </main>
  )
}
