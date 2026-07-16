/**
 * pm-scalp 诚实全窗口记分板 reader（2026-07-16，用户指令 A）。
 *
 * 只读白名单文件 analysis/honest-scorecard.json —— 由 gen_honest_scorecard.py
 * 每 10 分钟离线再生（去水分逻辑产线化）。把模拟盘的"平静窗自选成绩(海市蜃楼)"
 * 与"全窗口诚实口径(拒用/未成按真实收盘结果补)"并排，并给分日 regime 切分,
 * 让"趋势日撑起的假利润"无处藏。解析走纯函数以便单测；任何畸形降级为空,
 * 绝不抛错波及页面其它区块。
 */
import { promises as fs } from "node:fs"
import path from "node:path"

export interface HonestCalm {
  n: number
  w: number
  l: number
  winrate: number | null
  pnl: number
}

export interface HonestAllWindow {
  n: number
  w: number
  l: number
  winrate: number | null
  pnlOpt: number // fr=1 上界
  pnlFill: number // 真金成交率下界(仍未计毒性,偏乐观)
  noOutcome: number
}

export interface HonestDay {
  day: string
  n: number
  w: number
  l: number
  pnl: number
}

export interface HonestVariant {
  v: string
  calm: HonestCalm
  allWindow: HonestAllWindow
  byDay: HonestDay[]
}

export interface HonestScorecard {
  generated: string
  variants: HonestVariant[]
  fileMissing: boolean
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

function parseCalm(o: Record<string, unknown>): HonestCalm {
  return {
    n: num(o.n) ?? 0,
    w: num(o.w) ?? 0,
    l: num(o.l) ?? 0,
    winrate: num(o.winrate),
    pnl: num(o.pnl) ?? 0,
  }
}

function parseAll(o: Record<string, unknown>): HonestAllWindow {
  return {
    n: num(o.n) ?? 0,
    w: num(o.w) ?? 0,
    l: num(o.l) ?? 0,
    winrate: num(o.winrate),
    pnlOpt: num(o.pnlOpt) ?? 0,
    pnlFill: num(o.pnlFill) ?? 0,
    noOutcome: num(o.noOutcome) ?? 0,
  }
}

export function parseHonestScorecard(text: string): HonestScorecard {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { generated: "", variants: [], fileMissing: false }
  }
  if (typeof raw !== "object" || raw == null) {
    return { generated: "", variants: [], fileMissing: false }
  }
  const root = raw as { meta?: { generated_ts?: unknown }; variants?: unknown }
  const list = Array.isArray(root.variants) ? root.variants : []
  const out: HonestVariant[] = []
  for (const item of list) {
    if (typeof item !== "object" || item == null) continue
    const o = item as Record<string, unknown>
    if (typeof o.v !== "string") continue
    if (
      typeof o.calm !== "object" || o.calm == null ||
      typeof o.allWindow !== "object" || o.allWindow == null
    ) continue
    const byDay: HonestDay[] = []
    if (Array.isArray(o.byDay)) {
      for (const d of o.byDay as unknown[]) {
        if (typeof d !== "object" || d == null) continue
        const r = d as Record<string, unknown>
        if (typeof r.day !== "string") continue
        byDay.push({
          day: r.day,
          n: num(r.n) ?? 0,
          w: num(r.w) ?? 0,
          l: num(r.l) ?? 0,
          pnl: num(r.pnl) ?? 0,
        })
      }
    }
    out.push({
      v: o.v,
      calm: parseCalm(o.calm as Record<string, unknown>),
      allWindow: parseAll(o.allWindow as Record<string, unknown>),
      byDay,
    })
  }
  const generated = isoFromTs(num(root.meta?.generated_ts))
  return { generated, variants: out, fileMissing: false }
}

function baseDir(): string {
  return process.env.PM_SCALP_DIR ?? "/data/pm-scalp"
}

export async function readHonestScorecard(): Promise<HonestScorecard> {
  const file = path.join(baseDir(), "analysis", "honest-scorecard.json")
  let text: string
  try {
    text = await fs.readFile(file, "utf8")
  } catch {
    return { generated: "", variants: [], fileMissing: true }
  }
  try {
    return parseHonestScorecard(text)
  } catch {
    return { generated: "", variants: [], fileMissing: false }
  }
}
