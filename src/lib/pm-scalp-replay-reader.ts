/**
 * pm-scalp 真金交易回放 reader（tick-v1，2026-07-16 重写）。
 *
 * 只读一个白名单文件：analysis/trades-viz.json —— 由 gen_trades_viz.py 每
 * 5 分钟从 tick 全量捕获（/hdd/program-data/pm-scalp-ticks）离线再生，**自增**，
 * 滚动最近 20 笔真金单（含未成交）。与实盘账本 reader（pm-scalp-real-reader）
 * 刻意分离：本文件是展示性回放，不参与任何金额合计；解析全部走纯函数
 * parseReplayFile 以便单测直打。
 *
 * 数据是**买入侧份额价格空间**（0..1）：
 *   series 行 [s, bid, ask]  买入 token 的顶簿（tick 分辨率，末段密）
 *              赢单 → 收敛到 ~1；亏单 → 崩向 ~0
 *   prints 行 [s, price]     该 token 的真实成交打印（last_trade_price）
 */
import { promises as fs } from "node:fs"
import path from "node:path"

export interface ReplayPoint {
  s: number
  bid: number
  ask: number
}

export interface ReplayPrint {
  s: number
  price: number
}

export interface ReplayTrade {
  w: number
  windowLabel: string
  strategy: string
  side: "Up" | "Down"
  sEntry: number | null
  limit: number
  matched: number
  pnl: number
  won: boolean | null
  filled: boolean
  postMs: number | null
  q: number | null
  sigRem: number | null
  effSeen: number | null
  outcomeUp: number | null
  series: ReplayPoint[]
  prints: ReplayPrint[]
}

export interface ReplaySnapshot {
  generated: string
  trades: ReplayTrade[]
  fileMissing: boolean
}

function windowLabel(wts: number): string {
  // 展示用 +08 标签（与实盘页 窗口(+08) 列同口径）
  const d = new Date((wts + 8 * 3600) * 1000)
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(d.getUTCDate()).padStart(2, "0")
  const hh = String(d.getUTCHours()).padStart(2, "0")
  const mi = String(d.getUTCMinutes()).padStart(2, "0")
  return `${mm}-${dd} ${hh}:${mi}`
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

function isoFromTs(ts: number | null): string {
  if (ts == null) return ""
  const d = new Date((ts + 8 * 3600) * 1000) // +08 展示
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(d.getUTCDate()).padStart(2, "0")
  const hh = String(d.getUTCHours()).padStart(2, "0")
  const mi = String(d.getUTCMinutes()).padStart(2, "0")
  return `${mm}-${dd} ${hh}:${mi}`
}

/** 纯函数解析；任何行畸形 → 丢弃该行/该笔，绝不抛 NaN 进渲染层 */
export function parseReplayFile(text: string): ReplaySnapshot {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { generated: "", trades: [], fileMissing: false }
  }
  // 形状防御:合法 JSON 但形状不对(null 根/trades 非数组/条目 null)绝不能
  // 让展示层 500 整页
  if (typeof raw !== "object" || raw == null) {
    return { generated: "", trades: [], fileMissing: false }
  }
  const root = raw as {
    meta?: { generated_ts?: unknown }
    trades?: unknown
  }
  const list = Array.isArray(root.trades) ? root.trades : []
  const out: ReplayTrade[] = []
  for (const t of list) {
    if (typeof t !== "object" || t == null) continue
    const o = t as Record<string, unknown>
    const w = num(o.w)
    const limit = num(o.limit)
    const side = o.side === "Up" || o.side === "Down" ? o.side : null
    if (w == null || limit == null || side == null || !Array.isArray(o.series)) {
      continue
    }
    const series: ReplayPoint[] = []
    for (const row of o.series as unknown[]) {
      if (!Array.isArray(row) || row.length < 3) continue
      const s = num(row[0])
      const bid = num(row[1])
      const ask = num(row[2])
      if (s == null || bid == null || ask == null) continue
      series.push({ s, bid, ask })
    }
    if (series.length < 8) continue // 轨迹太残缺不展示

    const prints: ReplayPrint[] = []
    if (Array.isArray(o.prints)) {
      for (const row of o.prints as unknown[]) {
        if (!Array.isArray(row) || row.length < 2) continue
        const s = num(row[0])
        const price = num(row[1])
        if (s == null || price == null) continue
        prints.push({ s, price })
      }
    }

    out.push({
      w,
      windowLabel: windowLabel(w),
      strategy: typeof o.strategy === "string" ? o.strategy : "?",
      side,
      sEntry: num(o.sEntry),
      limit,
      matched: num(o.matched) ?? 0,
      pnl: num(o.pnl) ?? 0,
      won: typeof o.won === "boolean" ? o.won : null,
      filled: o.filled === true,
      postMs: num(o.postMs),
      q: num(o.q),
      sigRem: num(o.sigRem),
      effSeen: num(o.effSeen),
      outcomeUp: num(o.outcomeUp),
      series,
      prints,
    })
  }
  out.sort((a, b) => b.w - a.w) // 最新在前
  const generated = isoFromTs(num(root.meta?.generated_ts))
  return { generated, trades: out, fileMissing: false }
}

function baseDir(): string {
  return process.env.PM_SCALP_DIR ?? "/data/pm-scalp"
}

export async function readPmScalpReplay(): Promise<ReplaySnapshot> {
  const file = path.join(baseDir(), "analysis", "trades-viz.json")
  let text: string
  try {
    text = await fs.readFile(file, "utf8")
  } catch {
    return { generated: "", trades: [], fileMissing: true }
  }
  try {
    return parseReplayFile(text)
  } catch {
    // 双保险:解析器自身缺陷也不许波及页面其它区块
    return { generated: "", trades: [], fileMissing: false }
  }
}
