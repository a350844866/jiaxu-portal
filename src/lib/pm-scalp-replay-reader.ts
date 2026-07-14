/**
 * pm-scalp 真金交易回放 reader。
 *
 * 只读一个白名单文件：analysis/trades-viz.json —— 由分析脚本在批次结束后
 * 离线生成（含每笔已结算真金单的 1Hz Chainlink 位移轨迹 + 买入侧盘口）。
 * 与实盘账本 reader（pm-scalp-real-reader）刻意分离：本文件是展示性回放，
 * 不参与任何金额合计；解析全部走纯函数 parseReplayFile 以便单测直打。
 *
 * series 行格式（生成侧约定）：[s, cl_disp_bps, side_bid, side_ask]
 *   s            窗口内秒 (0-299)
 *   cl_disp_bps  Chainlink 相对开窗 strike 的位移（bps；>0=Up 领先）
 *   side_bid/ask 买入侧份额盘口（可为 null）
 */
import { promises as fs } from "node:fs"
import path from "node:path"

export interface ReplayPoint {
  s: number
  disp: number
  bid: number | null
  ask: number | null
}

export interface ReplayTrade {
  w: number
  windowLabel: string
  side: "Up" | "Down"
  sEntry: number
  dispEntry: number
  limit: number
  px: number
  matched: number
  pnl: number
  won: boolean
  postMs: number | null
  strike: number
  series: ReplayPoint[]
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

/** 纯函数解析；任何行畸形 → 丢弃该行/该笔，绝不抛 NaN 进渲染层 */
export function parseReplayFile(text: string): ReplaySnapshot {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { generated: "", trades: [], fileMissing: false }
  }
  // 形状防御:合法 JSON 但形状不对(null 根/trades 非数组/条目 null)绝不能
  // 让展示层 500 整页(review HIGH-1)
  if (typeof raw !== "object" || raw == null) {
    return { generated: "", trades: [], fileMissing: false }
  }
  const root = raw as { meta?: { generated?: string }; trades?: unknown }
  const list = Array.isArray(root.trades) ? root.trades : []
  const out: ReplayTrade[] = []
  for (const t of list) {
    if (typeof t !== "object" || t == null) continue
    const o = t as Record<string, unknown>
    const w = num(o.w)
    const sEntry = num(o.s)
    const px = num(o.px)
    const pnl = num(o.pnl)
    const dispEntry = num(o.disp)
    const strike = num(o.strike)
    const matched = num(o.matched)
    const limit = num(o.limit)
    const side = o.side === "Up" || o.side === "Down" ? o.side : null
    if (
      w == null || sEntry == null || px == null || pnl == null ||
      dispEntry == null || strike == null || matched == null ||
      limit == null || side == null || typeof o.won !== "boolean" ||
      !Array.isArray(o.series)
    ) continue
    const series: ReplayPoint[] = []
    for (const row of o.series as unknown[]) {
      if (!Array.isArray(row) || row.length < 2) continue
      const s = num(row[0])
      const disp = num(row[1])
      if (s == null || disp == null) continue
      series.push({ s, disp, bid: num(row[2]), ask: num(row[3]) })
    }
    if (series.length < 30) continue // 轨迹太残缺不展示
    out.push({
      w, windowLabel: windowLabel(w), side, sEntry, dispEntry,
      limit, px, matched, pnl, won: o.won, strike,
      postMs: num(o.post_ms), series,
    })
  }
  out.sort((a, b) => a.w - b.w)
  const generated =
    typeof root.meta?.generated === "string" ? root.meta.generated : ""
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
