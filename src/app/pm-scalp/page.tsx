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

// 变体战绩表(平静窗自选)2026-07-16 删除(海市蜃楼口径);2026-07-17 判定后老变体归档,
// 页面重构为单一「策略板」:只列在役策略,每个带大白话说明;已归档的收为一行灰字指向 vault 判定档案。
// 全部诊断数据仍在 honest-scorecard.json 供审计,页面只做展示裁剪。

const STRATEGY_DESC: Record<string, string> = {
  "C1M": "C1 信号的挂单版——只为测「挂单到底轮不轮得到」(可达性观察),非收益候选",
  "VN2": "VN1 的诚实重造:把握值改用 1497 个历史窗的实测频率查表,末段买大幅领先侧",
  "MC60-T80": "中窗持续确认 60 秒后买领先侧(模仿链上真赢家节奏)——预注册对照组,永不真金",
  "MC60-M20": "同上信号的挂单版",
  "EP1-T": "最后 18 秒买 0.95-0.99 的近必胜方(吃「结算保险费」)——吃单对照",
  "EP1-M": "同上思路挂单收保险费(主假设;挖掘口袋的证伪实验)",
}
const ACTIVE_MAIN = new Set(["C1M", "VN2"]) // variants[] 里仍在役的
const ARCHIVED_NOTE =
  "已归档:VN1 · C1-T500 · C1-T1000 · B1S(2026-07-17 判定,scanner 日落停累积)· XWJ 对(2026-07-20,goDecision NO_GO,CI 全负)——战绩与死因入档 vault「7 天期中判定」节"

function goBadge(v: { goStatus: string | null }, tw?: TripwireEntry) {
  if (tw && tw.status !== "ok" && tw.status !== "insufficient")
    return { text: `冻结:${tw.status}`, cls: "bg-amber-500/15 text-amber-300" }
  if (v.goStatus === "CONTROL_EXCLUDED")
    return { text: "对照组", cls: "bg-zinc-700/40 text-zinc-400" }
  if (v.goStatus === "NO_GO")
    return { text: "已证伪", cls: "bg-rose-500/15 text-rose-300" }
  if (v.goStatus === "ELIGIBLE_FOR_DISCUSSION")
    return { text: "够格讨论", cls: "bg-emerald-500/15 text-emerald-300" }
  if (v.goStatus === "INSUFFICIENT")
    return { text: "攒样本中", cls: "bg-cyan-500/10 text-cyan-300" }
  return { text: "观察中", cls: "bg-zinc-700/40 text-zinc-400" }
}

function StrategyBoard({
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
  // 统一行模型:在役 = variants 里的 C1M/VN2 + 全部 forward 变体
  const rows: { v: string; execEV: HonestVariant["execEV"]; goStatus: string | null }[] = [
    ...variants
      .filter((x) => ACTIVE_MAIN.has(x.v))
      .map((x) => ({ v: x.v, execEV: x.execEV, goStatus: null })),
    ...entryGated,
  ]
  return (
    <section className="rounded-2xl border border-amber-900/40 bg-amber-950/[0.08] p-4">
      <h2 className="text-sm font-medium text-zinc-200">
        策略板
        <span className="ml-2 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
          在役 {rows.length} · 成绩=实测执行(费后)
        </span>
        <span className="ml-2 text-xs font-normal text-zinc-500">
          全部纯模拟 forward-only;判定门 fail-closed,样本不够永远「攒样本中」
          {generated && ` · 更新于 ${generated}`}
        </span>
      </h2>
      {malformed > 0 && (
        <p className="mt-2 rounded border border-rose-800/50 bg-rose-950/30 px-2 py-1 text-[11px] text-rose-300">
          ⚠ {malformed} 个变体数据畸形被丢弃(坏数据不显示为 0)——检查生成器
        </p>
      )}
      {rows.length === 0 ? (
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
                <th className="py-1.5 pr-3 font-normal">策略</th>
                <th className="py-1.5 pr-3 font-normal">这是什么</th>
                <th className="py-1.5 pr-3 font-normal">状态</th>
                <th className="py-1.5 pr-3 text-right font-normal">实测执行</th>
                <th className="py-1.5 text-right font-normal">样本</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const badge = goBadge(r, tripwire[r.v.split("-")[0]] ?? tripwire[r.v])
                const e = r.execEV
                return (
                  <tr key={r.v} className="border-b border-zinc-800/50 last:border-0 align-top">
                    <td className="py-2 pr-3 font-mono text-zinc-200 whitespace-nowrap">{r.v}</td>
                    <td className="py-2 pr-3 text-zinc-400 leading-5">{STRATEGY_DESC[r.v] ?? "—"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <span className={cn("rounded px-1.5 py-px text-[10px]", badge.cls)}>{badge.text}</span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                      {e == null || e.filled === 0 ? (
                        <span className="text-zinc-500">{e ? "0 笔实测" : "—"}</span>
                      ) : (
                        <>
                          <span className={cn("font-semibold", pnlClass(e.netSum))}>{fmtUsd(e.netSum)}</span>
                          <span className="ml-1 text-zinc-600">
                            {e.w}W{e.l}L
                          </span>
                        </>
                      )}
                    </td>
                    <td className="py-2 text-right tabular-nums text-zinc-500 whitespace-nowrap">
                      {e ? `${e.filled}成/${e.n}签` : "—"}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] leading-5 text-zinc-600">{ARCHIVED_NOTE}</p>
          <p className="mt-1 text-[11px] leading-5 text-zinc-500">
            实测执行=真实成交模拟的费后盈亏(taker 计费/maker 悲观队列,拿不到 credit 不算成);
            强灌/诊断口径只进审计 JSON 不上桌面。真相以真金账本为准——当前真金零敞口。
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
        tape×tick 双采集互证 fail-closed,不可信窗整窗拒记(forward 变体用 entry-gated 口径:只按进场前数据判定,进场后流坏按官方结果补账)。
        变体池:在役 6(C1M/VN2/MC60 对/EP1 对,各自预注册 spec 冻结,只计围栏后窗口);VN1/C1 双胞胎/B1S/XWJ 对 已归档日落(XWJ 2026-07-20 NO_GO)。
        更早模型(exec≤4,papertrader 已退役)的账<span className="text-zinc-300">已整体归档出主账本</span>,对实盘判断无参考价值。判定日 {snap.judgmentDate} 主判 C1 真金,v5 前向为参考。
      </p>

      <p className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-3 py-2 text-[11px] leading-5 text-zinc-500">
        <span className="text-zinc-400">资金口径:</span>没有固定本金池——每笔独立投入 5 股(约 $2.5-5,对齐真金执行器规格),含买入成本与 taker 手续费(maker 部分零费),持有到窗口结算,不复利。
        样本注意:多个变体常在同一窗口开仓,盈亏高度相关,有效样本按独立窗口数看。
      </p>

      <StrategyBoard snap={honest} />

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
