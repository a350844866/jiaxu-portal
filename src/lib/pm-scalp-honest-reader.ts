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

/** 实测执行口径（headline,2026-07-17 全量 review A2:强灌反事实不再当成绩） */
export interface HonestExec {
  n: number
  filled: number
  w: number
  l: number
  netSum: number
  evPerIntent: number
  winrateFilled: number | null
  wilsonLB: number | null
}

export interface HonestVariant {
  v: string
  calm: HonestCalm
  allWindow: HonestAllWindow
  execEV: HonestExec | null
  byDay: HonestDay[]
}

/** entry-gated 新变体(XWJ/MC60)的最小展示面 */
export interface EntryGatedVariant {
  v: string
  execEV: HonestExec | null
  goStatus: string | null
}

export interface TripwireEntry {
  status: string
  perDay: number | null
  anchorPerDay: number | null
}

export interface HonestScorecard {
  generated: string
  variants: HonestVariant[]
  entryGated: EntryGatedVariant[]
  tripwire: Record<string, TripwireEntry>
  /** 严格校验丢弃的畸形变体数(>0 时页面显示警告,坏数据不许变成权威的 0) */
  malformed: number
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

// 严格校验(2026-07-17 review B-8):必填数值缺失/畸形 → 返回 null 丢弃整个变体,
// 绝不把坏数据默默变成权威的 0(负 PnL 损坏成 $0 = 高估通道)
function parseCalm(o: Record<string, unknown>): HonestCalm | null {
  const n = num(o.n), w = num(o.w), l = num(o.l), pnl = num(o.pnl)
  if (n == null || w == null || l == null || pnl == null) return null
  return { n, w, l, winrate: num(o.winrate), pnl }
}

function parseAll(o: Record<string, unknown>): HonestAllWindow | null {
  const n = num(o.n), w = num(o.w), l = num(o.l)
  const pnlOpt = num(o.pnlOpt), pnlFill = num(o.pnlFill)
  if (n == null || w == null || l == null || pnlOpt == null || pnlFill == null)
    return null
  return {
    n, w, l, winrate: num(o.winrate), pnlOpt, pnlFill,
    noOutcome: num(o.noOutcome) ?? 0,
  }
}

function parseExec(v: unknown): HonestExec | null {
  if (typeof v !== "object" || v == null) return null
  const o = v as Record<string, unknown>
  const n = num(o.n), filled = num(o.filled), w = num(o.w), l = num(o.l)
  const netSum = num(o.netSum), evPerIntent = num(o.evPerIntent)
  if (n == null || filled == null || w == null || l == null ||
      netSum == null || evPerIntent == null) return null
  return {
    n, filled, w, l, netSum, evPerIntent,
    winrateFilled: num(o.winrateFilled), wilsonLB: num(o.wilsonLB),
  }
}

const EMPTY: Omit<HonestScorecard, "fileMissing"> = {
  generated: "", variants: [], entryGated: [], tripwire: {}, malformed: 0,
}

export function parseHonestScorecard(text: string): HonestScorecard {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ...EMPTY, fileMissing: false }
  }
  if (typeof raw !== "object" || raw == null) {
    return { ...EMPTY, fileMissing: false }
  }
  const root = raw as {
    meta?: { generated_ts?: unknown }
    variants?: unknown
    entryGated?: { variants?: unknown; tripwire?: unknown }
  }
  const list = Array.isArray(root.variants) ? root.variants : []
  const out: HonestVariant[] = []
  let malformed = 0
  for (const item of list) {
    if (typeof item !== "object" || item == null) continue
    const o = item as Record<string, unknown>
    if (typeof o.v !== "string") continue
    if (
      typeof o.calm !== "object" || o.calm == null ||
      typeof o.allWindow !== "object" || o.allWindow == null
    ) {
      malformed++
      continue
    }
    const calm = parseCalm(o.calm as Record<string, unknown>)
    const allWindow = parseAll(o.allWindow as Record<string, unknown>)
    if (calm == null || allWindow == null) {
      malformed++ // 必填字段畸形:整变体丢弃并计数,不显示假 0
      continue
    }
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
    out.push({ v: o.v, calm, allWindow, execEV: parseExec(o.execEV), byDay })
  }

  // entry-gated 新变体(可缺省:旧 JSON 无此段);ep1 区段(2026-07-17)同形并入展示
  const eg: EntryGatedVariant[] = []
  const tripwire: Record<string, TripwireEntry> = {}
  const collect = (root2: unknown) => {
    if (typeof root2 !== "object" || root2 == null) return
    const r0 = root2 as { variants?: unknown; tripwire?: unknown }
    if (Array.isArray(r0.variants)) {
      for (const item of r0.variants as unknown[]) {
        if (typeof item !== "object" || item == null) continue
        const o = item as Record<string, unknown>
        if (typeof o.v !== "string") continue
        const go = o.goDecision as Record<string, unknown> | undefined
        // EP1 用 primary(nIntents/creditedFills),XWJ/MC60 用 execEV(n/filled)——归一成 execEV 形
        let exec = parseExec(o.execEV)
        if (exec == null && typeof o.primary === "object" && o.primary != null) {
          const p = o.primary as Record<string, unknown>
          exec = parseExec({
            n: p.nIntents, filled: p.creditedFills,
            w: p.filledW, l: p.filledL,
            netSum: p.netSum, evPerIntent: num(p.evPerIntent) ?? 0,
            winrateFilled: p.winrateFilled, wilsonLB: p.wilsonLB,
          })
        }
        eg.push({
          v: o.v,
          execEV: exec,
          goStatus:
            go && typeof go === "object" && typeof go.status === "string"
              ? go.status
              : null,
        })
      }
    }
    const tw = r0.tripwire
    if (typeof tw === "object" && tw != null) {
      for (const [k, v] of Object.entries(tw as Record<string, unknown>)) {
        if (typeof v !== "object" || v == null) continue
        const r = v as Record<string, unknown>
        if (typeof r.status !== "string") continue
        tripwire[k] = {
          status: r.status,
          perDay: num(r.perDay),
          anchorPerDay: num(r.anchorPerDay),
        }
      }
    }
  }
  collect(root.entryGated)
  collect((root as { ep1?: unknown }).ep1)

  const generated = isoFromTs(num(root.meta?.generated_ts))
  return { generated, variants: out, entryGated: eg, tripwire, malformed, fileMissing: false }
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
    return { generated: "", variants: [], entryGated: [], tripwire: {}, malformed: 0, fileMissing: true }
  }
  try {
    return parseHonestScorecard(text)
  } catch {
    return { generated: "", variants: [], entryGated: [], tripwire: {}, malformed: 0, fileMissing: false }
  }
}
