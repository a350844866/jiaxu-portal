import type { EventLaneView, EventPositionRow } from "@/lib/pm-paper-event-reader"
import { cn } from "@/lib/utils"

/** 事件快车道(Phase 1 shadow 遥测)面板 — 漏斗/caps/影子仓/配对差。 */

function ageText(sec: number | null): string {
  if (sec == null) return "—"
  if (sec < 60) return `${sec}s 前`
  if (sec < 3600) return `${Math.floor(sec / 60)}min 前`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h 前`
  return `${Math.floor(sec / 86400)}d 前`
}

const STAGE_LABELS: [string, string][] = [
  ["weak_match", "弱命中"],
  ["triage_queued", "进分诊"],
  ["cooldown_skip", "冷却跳过"],
  ["stale_skip", "超龄跳过"],
  ["overflow", "超额留痕"],
  ["triage_pass", "分诊通过"],
  ["triage_fail", "分诊拒绝"],
  ["triage_missing", "分诊漏答"],
  ["predict_overflow", "预测超额"],
  ["predict_missing", "预测漏答"],
  ["no_signal", "无信号"],
  ["shadow_skipped_book", "簿不可用"],
  ["shadow_opened", "开影子仓"],
]

const LEG_LABELS: [string, string][] = [
  ["taker0", "即时吃单"],
  ["maker0", "即时挂单"],
  ["taker30", "+30min"],
  ["taker180", "+3h"],
]

function legChip(status: string, fillPx: number | null): { text: string; cls: string } {
  switch (status) {
    case "filled":
      return { text: fillPx != null ? `成交@${fillPx.toFixed(2)}` : "成交", cls: "text-emerald-400" }
    case "open":
    case "pending":
      return { text: "等待", cls: "text-zinc-400" }
    case "expired":
      return { text: "TTL过期", cls: "text-zinc-500" }
    case "missed":
      return { text: "采样洞", cls: "text-amber-400" }
    case "truncated":
      return { text: "被截尾", cls: "text-zinc-500" }
    default:
      return { text: status, cls: "text-zinc-500" }
  }
}

function mtmText(v: number | null): string {
  if (v == null) return "—"
  const sign = v > 0 ? "+" : ""
  return `${sign}${v.toFixed(2)}`
}

function mtmClass(v: number | null): string {
  if (v == null) return "text-zinc-500"
  return v > 0 ? "text-emerald-400" : v < 0 ? "text-rose-400" : "text-zinc-300"
}

function PositionRow({ pos }: { pos: EventPositionRow }) {
  return (
    <tr className="border-t border-zinc-800/60">
      <td className="max-w-[16rem] truncate py-1.5 pr-3 text-zinc-300" title={pos.marketQuestion ?? pos.predictionId}>
        {pos.marketQuestion ?? pos.predictionId}
        {!pos.latencyOk && (
          <span className="ml-1 rounded bg-zinc-800 px-1 text-[10px] text-zinc-500" title="新闻链超时延门槛,不进主检验">
            慢链
          </span>
        )}
      </td>
      <td className="py-1.5 pr-3 text-zinc-300">
        {pos.side} · p={pos.p.toFixed(2)}
        {pos.execMid != null && <span className="text-zinc-500"> / mid {pos.execMid.toFixed(2)}</span>}
      </td>
      {LEG_LABELS.map(([key]) => {
        const leg = pos.legs[key]
        const chip = leg ? legChip(leg.status, leg.fillPx) : { text: "—", cls: "text-zinc-600" }
        return (
          <td key={key} className={cn("py-1.5 pr-3 text-xs", chip.cls)}>
            {chip.text}
          </td>
        )
      })}
      <td className={cn("py-1.5 pr-3 text-right tabular-nums", mtmClass(pos.mtm6h))}>{mtmText(pos.mtm6h)}</td>
      <td className={cn("py-1.5 text-right tabular-nums", mtmClass(pos.mtm24h))}>
        {pos.settledWon != null ? (pos.settledWon ? "✓ 赢" : "✗ 输") : mtmText(pos.mtm24h)}
      </td>
    </tr>
  )
}

export function EventLanePanel({ lane }: { lane: EventLaneView }) {
  if (!lane.present) return null

  const funnelChips = STAGE_LABELS.filter(([k]) => lane.funnelTotal[k]).map(([k, label]) => ({
    key: k,
    label,
    total: lane.funnelTotal[k] ?? 0,
    today: lane.funnelToday[k] ?? 0,
  }))
  const pairedAll = lane.paired["all"] ?? {}
  const pairedEndpoints = Object.entries(pairedAll)

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-zinc-100">⚡ 事件快车道</h2>
        <span className="text-[11px] text-zinc-500">
          Phase 1 shadow 遥测 · 新闻触发 → 分诊 → 即时预测 → 配对影子执行(零真单)
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-zinc-500">
          <span
            className={cn("inline-block h-2 w-2 rounded-full", lane.watcherStale ? "bg-rose-500" : "bg-emerald-500")}
            title={lane.watcherStale ? "watcher 心跳超时" : "watcher 正常"}
          />
          watcher {ageText(lane.watcherAgeSeconds)}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-400">
        <span>
          今日 LLM:分诊 <span className="text-zinc-200">{lane.capsToday.triage}/{lane.capsToday.triageCap}</span>
          {" · "}预测 <span className="text-zinc-200">{lane.capsToday.predict}/{lane.capsToday.predictCap}</span>
        </span>
        <span>
          累计预测 <span className="text-zinc-200">{lane.predictionsCount}</span> · 影子仓{" "}
          <span className="text-zinc-200">{lane.positions.length}</span>
          {lane.settled && (
            <>
              {" · "}已结算 <span className="text-zinc-200">{lane.settled.n}</span>(taker0{" "}
              <span className={mtmClass(lane.settled.taker0PnlSum)}>{mtmText(lane.settled.taker0PnlSum)}</span>)
            </>
          )}
        </span>
      </div>

      {funnelChips.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {funnelChips.map((c) => (
            <span
              key={c.key}
              className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400"
              title={`今日 ${c.today}`}
            >
              {c.label} <span className="text-zinc-200">{c.total}</span>
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-zinc-500">
          待首次新闻触发 — watcher 每 10 分钟扫 news-corpus 增量,命中 89 盘关键词才叫醒 LLM。
        </p>
      )}

      {pairedEndpoints.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {pairedEndpoints.map(([endpoint, b]) => (
            <div key={endpoint} className="rounded-lg border border-zinc-800/70 bg-zinc-950/40 px-3 py-2 text-xs">
              <div className="text-zinc-500">{endpoint.replace("_taker0_minus_", " 早进−晚进 ")}</div>
              <div className="mt-0.5">
                <span className={cn("text-sm font-semibold tabular-nums", mtmClass(b.mean))}>{mtmText(b.mean)}</span>
                <span className="ml-2 text-zinc-500">
                  n={b.n}
                  {b.ci95 && ` · CI95 [${b.ci95[0].toFixed(2)}, ${b.ci95[1].toFixed(2)}]`}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {lane.positions.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-xs">
            <thead>
              <tr className="text-[11px] text-zinc-500">
                <th className="py-1 pr-3 font-normal">市场</th>
                <th className="py-1 pr-3 font-normal">信号</th>
                {LEG_LABELS.map(([k, label]) => (
                  <th key={k} className="py-1 pr-3 font-normal">{label}</th>
                ))}
                <th className="py-1 pr-3 text-right font-normal">MTM 6h</th>
                <th className="py-1 text-right font-normal">24h/终局</th>
              </tr>
            </thead>
            <tbody>
              {lane.positions.map((pos) => (
                <PositionRow key={pos.predictionId} pos={pos} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
