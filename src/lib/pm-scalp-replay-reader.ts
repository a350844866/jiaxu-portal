/**
 * pm-scalp 真金交易回放 reader（btc-v1，2026-07-16 重写）。
 *
 * 只读白名单文件 analysis/trades-viz.json —— 由 gen_trades_viz.py 每 5 分钟
 * 从 1Hz 磁带离线再生，**自增**，滚动最近 20 笔真金单（含未成交）。
 * 与实盘账本 reader 刻意分离：本文件是展示性回放，不参与任何金额合计；
 * 解析全部走纯函数 parseReplayFile 以便单测直打。
 *
 * 纵轴 = **BTC 相对开盘价的偏离（美元）**——Chainlink（结算源）路径,决定输赢的那条线。
 *   btc 行 [s, dev]  s=窗口内秒, dev = cl − 开盘 strike（$；>0=BTC 高于开盘）
 *   赢=BTC 停在买入侧那一半（Up 买家要 dev>0 收窗, Down 要 dev<0）。
 *   注意 BTC 价在本采集里是 1Hz（tick 流是份额价、无 BTC tick）。
 */
import { promises as fs } from "node:fs"
import path from "node:path"

export interface ReplayPoint {
  s: number
  dev: number
}

export interface ReplayTrade {
  w: number
  oid: string | null
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
  strike: number
  btc: ReplayPoint[]
}

export interface ReplaySnapshot {
  generated: string
  trades: ReplayTrade[]
  fileMissing: boolean
}

/** epoch 秒 → "MM-DD HH:mm"（+08 展示） */
function fmtBeijing(ts: number): string {
  const d = new Date((ts + 8 * 3600) * 1000)
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
  if (typeof raw !== "object" || raw == null) {
    return { generated: "", trades: [], fileMissing: false }
  }
  const root = raw as {
    meta?: { generated_ts?: unknown; schema?: unknown }
    trades?: unknown
  }
  // 根 schema 守卫：显式声明非 btc-v1 的文件整体拒收（缺省兼容放行）
  if (root.meta?.schema != null && root.meta.schema !== "btc-v1") {
    return { generated: "", trades: [], fileMissing: false }
  }
  const list = Array.isArray(root.trades) ? root.trades : []
  const out: ReplayTrade[] = []
  for (const t of list) {
    if (typeof t !== "object" || t == null) continue
    const o = t as Record<string, unknown>
    // 前向 schema 守卫：显式标了非 btc-v1 的笔丢弃（防未来语义变更沿用同字段名时静默错图）
    if (o._schema != null && o._schema !== "btc-v1") continue
    const w = num(o.w)
    const limit = num(o.limit)
    const strike = num(o.strike)
    const side = o.side === "Up" || o.side === "Down" ? o.side : null
    if (
      w == null || limit == null || strike == null || strike <= 0 ||
      side == null || !Array.isArray(o.btc)
    ) continue
    const raw2: ReplayPoint[] = []
    for (const row of o.btc as unknown[]) {
      if (!Array.isArray(row) || row.length < 2) continue
      const s = num(row[0])
      const dev = num(row[1])
      // s 必须是窗口内整秒（1Hz 采样），越界/非整秒行丢弃
      if (s == null || dev == null || !Number.isInteger(s) || s < 0 || s > 300)
        continue
      raw2.push({ s, dev })
    }
    // 乱序/重复行防御：按 s 升序排（终点取样/折线几何都依赖单调），同秒保留首个
    raw2.sort((a, b) => a.s - b.s)
    const btc: ReplayPoint[] = []
    for (const p of raw2) {
      if (btc.length === 0 || p.s !== btc[btc.length - 1].s) btc.push(p)
    }
    if (btc.length < 8) continue // 轨迹太残缺不展示

    // 终态一致性守卫：成交单必须 won 布尔 + pnl 有限 + matched>0；
    // 未成交单必须 won 空 + matched 0。不一致 = 数据损坏，整笔丢弃——
    // 不给残缺数据编造 0 盈亏 / 胜负（诚实展示铁律）
    const matched = num(o.matched) ?? 0
    const pnlRaw = num(o.pnl)
    const filled = o.filled === true
    const wonRaw = o.won
    if (filled) {
      if (typeof wonRaw !== "boolean" || pnlRaw == null || !(matched > 0))
        continue
    } else if (wonRaw != null || matched > 0) {
      continue
    }

    out.push({
      w,
      oid: typeof o._oid === "string" ? o._oid : null,
      windowLabel: fmtBeijing(w),
      strategy: typeof o.strategy === "string" ? o.strategy : "?",
      side,
      sEntry: num(o.sEntry),
      limit,
      matched,
      pnl: filled ? pnlRaw! : 0,
      won: filled ? (wonRaw as boolean) : null,
      filled,
      postMs: num(o.postMs),
      q: num(o.q),
      strike,
      btc,
    })
  }
  out.sort((a, b) => b.w - a.w) // 最新在前
  const genTs = num(root.meta?.generated_ts)
  const generated = genTs == null ? "" : fmtBeijing(genTs)
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
    return { generated: "", trades: [], fileMissing: false }
  }
}
