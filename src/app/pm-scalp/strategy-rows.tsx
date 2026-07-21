"use client"

/**
 * 策略板可交互行（下钻）：点策略行 → 拉该变体成交记录（/api/pm-scalp/paper-trades）；
 * 点某笔记录 → 拉该窗 1Hz 轨迹（/api/pm-scalp/paper-window）画 MiniChart。
 * 服务端只传展示所需的纯数据 props；本组件不做任何口径计算。
 */
import { useState } from "react"
import { cn } from "@/lib/utils"
import { MiniChart, fmtUsd, type Zoom, type ChartTradeLike } from "./mini-chart"

export interface StrategyRowProp {
  v: string
  desc: string
  badgeText: string
  badgeCls: string
  exec: { netSum: number; w: number; l: number; filled: number; n: number } | null
}

interface TradeRow {
  w: number
  windowLabel: string
  s: number | null
  sideUp: boolean
  limit: number
  settle: string
  won: boolean | null
  net: number | null
}

type TradesState =
  | { st: "loading" }
  | { st: "error"; msg: string }
  | { st: "ok"; rows: TradeRow[]; total: number }

type WindowResp = ChartTradeLike & { settle: string | null }

type ChartState =
  | { st: "loading" }
  | { st: "error"; msg: string }
  | { st: "ok"; t: WindowResp }

function pnlClass(n: number | null): string {
  if (n == null || n === 0) return "text-zinc-400"
  return n > 0 ? "text-emerald-400" : "text-rose-400"
}

function settleText(r: { settle: string; won: boolean | null; net: number | null }):
  { text: string; cls: string } {
  if (r.settle === "settled") {
    // settled 但 won 缺失:防御性中性显示,绝不把 null 当亏损(review minor #2)
    if (r.won == null) return { text: "已成交·待判", cls: "text-zinc-400" }
    return r.won
      ? { text: `胜 ${fmtUsd(r.net ?? 0)}`, cls: "text-emerald-400" }
      : { text: `负 ${fmtUsd(r.net ?? 0)}`, cls: "text-rose-400" }
  }
  if (r.settle === "nofill") return { text: "未成交", cls: "text-zinc-500" }
  if (r.settle === "pending") return { text: "待结算", cls: "text-zinc-400" }
  if (r.settle === "unusable_window")
    // crossval 数据健康验证未过:信号照记但拒绝模拟成交,不计任何战绩(fail-closed)
    return { text: "数据拒用", cls: "text-amber-500/80" }
  return { text: r.settle, cls: "text-zinc-500" }
}

export function StrategyRows({ rows }: { rows: StrategyRowProp[] }) {
  const [openV, setOpenV] = useState<string | null>(null)
  const [trades, setTrades] = useState<Record<string, TradesState>>({})
  const [openW, setOpenW] = useState<number | null>(null)
  const [charts, setCharts] = useState<Record<string, ChartState>>({})
  const [zoom, setZoom] = useState<Zoom>("tail")

  async function toggleVariant(v: string) {
    if (openV === v) {
      setOpenV(null)
      setOpenW(null)
      return
    }
    setOpenV(v)
    setOpenW(null)
    if (trades[v]?.st === "ok") return
    setTrades((m) => ({ ...m, [v]: { st: "loading" } }))
    try {
      const r = await fetch(`/api/pm-scalp/paper-trades?v=${encodeURIComponent(v)}`)
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
      setTrades((m) => ({ ...m, [v]: { st: "ok", rows: j.rows, total: j.total } }))
    } catch (e) {
      setTrades((m) => ({
        ...m, [v]: { st: "error", msg: e instanceof Error ? e.message : "加载失败" },
      }))
    }
  }

  async function toggleTrade(v: string, w: number) {
    if (openW === w) {
      setOpenW(null)
      return
    }
    setOpenW(w)
    const key = `${v}:${w}`
    if (charts[key]?.st === "ok") return
    setCharts((m) => ({ ...m, [key]: { st: "loading" } }))
    try {
      const r = await fetch(
        `/api/pm-scalp/paper-window?w=${w}&v=${encodeURIComponent(v)}`)
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
      setCharts((m) => ({ ...m, [key]: { st: "ok", t: j as WindowResp } }))
    } catch (e) {
      setCharts((m) => ({
        ...m, [key]: { st: "error", msg: e instanceof Error ? e.message : "加载失败" },
      }))
    }
  }

  return (
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
          const e = r.exec
          const open = openV === r.v
          const ts = trades[r.v]
          return (
            <StrategyRowGroup key={r.v}>
              <tr
                className={cn(
                  "cursor-pointer border-b border-zinc-800/50 align-top hover:bg-zinc-900/40",
                  open && "bg-zinc-900/40",
                )}
                onClick={() => toggleVariant(r.v)}
                title="点击查看成交记录"
              >
                <td className="py-2 pr-3 font-mono text-zinc-200 whitespace-nowrap">
                  <span className={cn("mr-1 inline-block text-zinc-600 transition-transform", open && "rotate-90")}>▸</span>
                  {r.v}
                </td>
                <td className="py-2 pr-3 text-zinc-400 leading-5">{r.desc}</td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  <span className={cn("rounded px-1.5 py-px text-[10px]", r.badgeCls)}>{r.badgeText}</span>
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
              {open && (
                <tr className="border-b border-zinc-800/50">
                  <td colSpan={5} className="bg-zinc-950/60 px-3 py-2">
                    {ts?.st === "loading" && (
                      <p className="py-1 text-[11px] text-zinc-500">成交记录加载中…</p>
                    )}
                    {ts?.st === "error" && (
                      <p className="py-1 text-[11px] text-rose-300">加载失败：{ts.msg}</p>
                    )}
                    {ts?.st === "ok" && ts.rows.length === 0 && (
                      <p className="py-1 text-[11px] text-zinc-500">该变体暂无签单记录</p>
                    )}
                    {ts?.st === "ok" && ts.rows.length > 0 && (
                      <div>
                        <p className="mb-1 text-[11px] text-zinc-500">
                          最近 {ts.rows.length} 笔（共 {ts.total}，新→旧）· 点击某笔看该窗 BTC 轨迹
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {ts.rows.map((t) => {
                            const stx = settleText(t)
                            const sel = openW === t.w
                            return (
                              <button
                                key={t.w}
                                onClick={() => toggleTrade(r.v, t.w)}
                                className={cn(
                                  "rounded border px-2 py-1 text-left text-[11px] tabular-nums",
                                  sel
                                    ? "border-cyan-500/50 bg-cyan-500/10"
                                    : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-600",
                                )}
                              >
                                <span className="text-zinc-300">{t.windowLabel}</span>
                                <span className={cn("ml-1.5", t.sideUp ? "text-emerald-300/90" : "text-rose-300/90")}>
                                  {t.sideUp ? "Up" : "Dn"}@{t.limit.toFixed(2)}
                                </span>
                                <span className={cn("ml-1.5 font-medium", stx.cls)}>{stx.text}</span>
                              </button>
                            )
                          })}
                        </div>
                        {openW != null && (
                          <WindowChart
                            state={charts[`${r.v}:${openW}`]}
                            zoom={zoom}
                            setZoom={setZoom}
                          />
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </StrategyRowGroup>
          )
        })}
      </tbody>
    </table>
  )
}

// tbody 里不能包非 tr 元素——用 Fragment 别名保持 JSX 可读
function StrategyRowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

function WindowChart({
  state, zoom, setZoom,
}: {
  state: ChartState | undefined
  zoom: Zoom
  setZoom: (z: Zoom) => void
}) {
  if (!state) return null
  if (state.st === "loading")
    return <p className="mt-2 text-[11px] text-zinc-500">轨迹加载中…</p>
  if (state.st === "error")
    return <p className="mt-2 text-[11px] text-rose-300">轨迹加载失败：{state.msg}</p>
  const t = state.t
  return (
    <div className="mt-2 max-w-md rounded-xl border border-zinc-800 bg-zinc-950/40 p-2.5">
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
        <span className="tabular-nums text-zinc-300">
          {t.windowLabel}
          <span className={cn("ml-2", t.side === "Up" ? "text-emerald-300/90" : "text-rose-300/90")}>
            {t.side}@{t.limit.toFixed(2)}
          </span>
          <span
            className={cn(
              "ml-2 font-semibold",
              t.settle === "unusable_window"
                ? "text-amber-500/80"
                : t.won == null
                  ? "text-zinc-400"
                  : t.won
                    ? "text-emerald-400"
                    : "text-rose-400",
            )}
          >
            {t.settle === "unusable_window"
              ? "数据拒用"
              : t.won == null
                ? "未成交"
                : t.won
                  ? "胜"
                  : "负"}
            {t.filled && t.won != null && ` ${fmtUsd(t.pnl)}`}
          </span>
        </span>
        <span className="flex gap-1">
          {([["tail", "末60s"], ["full", "全窗"]] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setZoom(k)}
              className={cn(
                "rounded border px-1.5 py-0.5 text-[10px]",
                zoom === k
                  ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
                  : "border-zinc-700 text-zinc-400 hover:text-zinc-200",
              )}
            >
              {label}
            </button>
          ))}
        </span>
      </div>
      {/* key=zoom：切换缩放重挂载清空悬停态（沿用 real 回放的防过期十字线做法） */}
      <MiniChart key={zoom} t={t} zoom={zoom} />
      <p className="mt-1 text-[10px] leading-4 text-zinc-600">
        线=BTC(Chainlink)相对开盘价偏离$ · 0线=开盘价 · 淡绿=买入侧胜区 · 悬停看$与bps · 胜负以交易所结算为准(1Hz采样)
      </p>
    </div>
  )
}
