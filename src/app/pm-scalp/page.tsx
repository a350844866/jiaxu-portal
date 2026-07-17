import Link from "next/link"
import { readPmScalpSnapshot, type PmScalpTradeRow } from "@/lib/pm-scalp-reader"
import {
  readHonestScorecard,
  type HonestVariant,
  type EntryGatedVariant,
  type TripwireEntry,
} from "@/lib/pm-scalp-honest-reader"
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

// 变体战绩表(平静窗自选口径)已于 2026-07-16 整体删除——那正是骗过真金决策的
// 海市蜃楼口径(互证拒用近半窗只考简单题),按"单向保真"原则永久失去展示资格;
// 平静窗数字仅在下方诚实表里作为反面对照列保留。
function HonestScorecard({
  snap,
}: {
  snap: {
    variants: HonestVariant[]
    entryGated: EntryGatedVariant[]
    tripwire: Record<string, TripwireEntry>
    malformed: number
    generated: string
    fileMissing: boolean
  }
}) {
  const { variants, entryGated, tripwire, malformed, generated, fileMissing } = snap
  return (
    <section className="rounded-2xl border border-amber-900/40 bg-amber-950/[0.08] p-4">
      <h2 className="text-sm font-medium text-zinc-200">
        诚实口径
        <span className="ml-2 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
          实测执行为准 · 强灌列仅诊断
        </span>
        <span className="ml-2 text-xs font-normal text-zinc-500">
          headline=真实成交模拟的执行盈亏(实测);「全窗诊断」把拒用/未成窗按限价强灌
          +真实收盘补回——它防跳题作弊,但本身偏乐观,不作成绩
          {generated && ` · 更新于 ${generated}`}
        </span>
      </h2>
      {malformed > 0 && (
        <p className="mt-2 rounded border border-rose-800/50 bg-rose-950/30 px-2 py-1 text-[11px] text-rose-300">
          ⚠ {malformed} 个变体数据畸形被丢弃(坏数据不显示为 0)——检查生成器
        </p>
      )}
      {variants.length === 0 ? (
        <p className="mt-3 text-xs text-zinc-500">
          {fileMissing
            ? "记分板文件缺失(analysis/honest-scorecard.json,gen_honest_scorecard.py 每 10min 再生)"
            : "记分板暂无可展示变体"}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[680px] text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-zinc-500">
                <th className="py-1.5 pr-3 font-normal">变体</th>
                <th className="py-1.5 pr-3 text-right font-normal">实测执行(headline)</th>
                <th className="py-1.5 pr-3 text-right font-normal">全窗诊断·乐观(成交率折算 / fr=1)</th>
                <th className="py-1.5 pr-3 text-right font-normal">平静窗(海市蜃楼对照)</th>
                <th className="py-1.5 font-normal">分日(regime,诊断口径)</th>
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
                      {v.execEV == null || v.execEV.filled === 0 ? (
                        <span className="text-zinc-500">
                          {v.execEV ? `0 笔实测(${v.execEV.n} intent)` : "—"}
                        </span>
                      ) : (
                        <>
                          <span className={cn("font-semibold", pnlClass(v.execEV.netSum))}>
                            {fmtUsd(v.execEV.netSum)}
                          </span>
                          <span className="ml-1 text-zinc-600">
                            {v.execEV.filled}成 {v.execEV.w}W{v.execEV.l}L
                            {v.execEV.wilsonLB != null && ` LB${(v.execEV.wilsonLB * 100).toFixed(0)}%`}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-zinc-400">
                      <span className={pnlClass(v.allWindow.pnlFill)}>{fmtUsd(v.allWindow.pnlFill)}</span>
                      <span className="text-zinc-600"> / </span>
                      <span className={pnlClass(v.allWindow.pnlOpt)}>{fmtUsd(v.allWindow.pnlOpt)}</span>
                      <span className="ml-1 text-zinc-600">
                        {v.allWindow.n}单
                        {v.allWindow.noOutcome > 0 && (
                          <span className="text-amber-400/80"> 缺{v.allWindow.noOutcome}</span>
                        )}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      <span className={pnlClass(v.calm.pnl)}>{fmtUsd(v.calm.pnl)}</span>
                      <span className="ml-1 text-zinc-600">
                        {v.calm.n}单 {v.calm.winrate == null ? "—" : `${(v.calm.winrate * 100).toFixed(0)}%`}
                      </span>
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
          {entryGated.length > 0 && (
            <div className="mt-3 border-t border-zinc-800/60 pt-2">
              <div className="mb-1 text-[11px] text-zinc-400">
                forward-only 新变体(2026-07-16 预注册,只计部署后窗口;成绩=实测执行)
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] tabular-nums">
                {entryGated.map((v) => (
                  <span key={v.v} className="text-zinc-400">
                    <span className="font-mono text-zinc-300">{v.v}</span>
                    {v.execEV == null || v.execEV.filled === 0 ? (
                      <span className="ml-1 text-zinc-500">
                        {v.execEV ? `0 实测/${v.execEV.n} intent` : "—"}
                      </span>
                    ) : (
                      <span className={cn("ml-1", pnlClass(v.execEV.netSum))}>
                        {fmtUsd(v.execEV.netSum)}({v.execEV.filled}成)
                      </span>
                    )}
                    {v.goStatus && (
                      <span
                        className={cn(
                          "ml-1 rounded px-1 py-px text-[9px]",
                          v.goStatus === "CONTROL_EXCLUDED"
                            ? "bg-zinc-700/40 text-zinc-400"
                            : "bg-cyan-500/10 text-cyan-300",
                        )}
                      >
                        {v.goStatus}
                      </span>
                    )}
                  </span>
                ))}
                {Object.entries(tripwire).map(([k, t]) =>
                  t.status !== "ok" ? (
                    <span key={k} className="rounded bg-amber-500/15 px-1.5 py-px text-[10px] text-amber-300">
                      ⚠ {k} {t.status}({t.perDay ?? "?"}/天 vs 锚 {t.anchorPerDay ?? "?"})
                    </span>
                  ) : null,
                )}
              </div>
            </div>
          )}
          <p className="mt-2 text-[11px] leading-5 text-zinc-500">
            全窗诊断列:左=按真金成交率折算(仍未计
            <span className="text-zinc-400">成交毒性</span>——亏单更易成交,真实更差),右=fr=1 全成上界;
            两者都是「假定能按限价成交」的反事实,只用于抓平静窗自选作弊,不是可实现盈亏。
            <span className="text-amber-300/80">分日提醒:C1 系诊断面即便为正,利润几乎全压单一趋势日</span>——
            与真金同构。真相以真金账本为准。
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
          定价/位移决策用 Polymarket 结算同源的 Chainlink 流,币安作同向确认门与基差观测。全部虚拟资金。
        </p>
        <PmScalpTabs active="paper" />
      </header>

      {/* 健康条 — 仪器状态,不放任何成绩数字(总盈亏卡=平静窗聚合,2026-07-16
          按单向保真删除;成绩只看下方诚实全窗口表) */}
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <FreshDot sec={snap.dataAgeSeconds} staleAfter={15} /> 记录器数据流
          </div>
          <div className="mt-1 text-sm font-semibold text-zinc-200">{ageText(snap.dataAgeSeconds)}</div>
          <div className="text-[11px] text-zinc-500">已覆盖 {snap.windowsRecorded} 个窗口 · 持仓 {snap.totals.open}</div>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <FreshDot sec={snap.heartbeatAgeSeconds} staleAfter={45} /> 模拟执行器心跳
          </div>
          <div className="mt-1 text-sm font-semibold text-zinc-200">{ageText(snap.heartbeatAgeSeconds)}</div>
          <div className="text-[11px] text-zinc-500">watchdog 每 5min 保活</div>
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
        tape×tick 双采集互证 fail-closed,不可信窗整窗拒记(新变体用 entry-gated 口径:只按进场前数据判定,进场后流坏按官方结果补账)。
        变体池:v5 幸存者(C1 家族/VN1/B1S,SPEC-ticksim-v5 冻结)+ forward-only 扩充(VN2/XWJ/MC60,各自预注册 spec 冻结,只计部署后窗口)。
        更早模型(exec≤4,papertrader 已退役)的账<span className="text-zinc-300">已整体归档出主账本</span>,对实盘判断无参考价值。判定日 {snap.judgmentDate} 主判 C1 真金,v5 前向为参考。
      </p>

      <p className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-3 py-2 text-[11px] leading-5 text-zinc-500">
        <span className="text-zinc-400">资金口径:</span>没有固定本金池——每笔独立投入 5 股(约 $2.5-5,对齐真金执行器规格),含买入成本与 taker 手续费(maker 部分零费),持有到窗口结算,不复利。
        样本注意:多个变体常在同一窗口开仓,盈亏高度相关,有效样本按独立窗口数看。
      </p>

      <HonestScorecard snap={honest} />

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
        数据:家服 /data/pm-scalp(recorder 秒级采集 + ticksim v5 关窗回放)· 账本 {snap.ledgerSince} · 仅模拟研究,非投资建议
      </footer>
    </main>
  )
}
