// AI 全产业链看板的纯类型 + 解析 + 格式化(client-safe,无 node:fs)。
// 数据权威源是 vault `wiki/concepts/AI全产业链地图.md`,机读层 `wiki/concepts/ai-chain.json`
// 由 Claude 随地图页联动维护;quotes.json 由家服 cron(yfinance)日更。
// IO 在 "@/lib/ai-chain-reader",与 serenity-pure / serenity-reader 的拆分方式一致。

export type CpLevel = "yes" | "partial" | "no"
export type SignalType = "bullish" | "bearish" | "watch" | "avoid"
export type SignalSource = "alan" | "serenity" | "taieo" | "claude"

export interface ChainSignal {
  date: string
  source: SignalSource
  type: SignalType
  note: string
  ref?: string
}

export interface ChainStock {
  ticker: string
  name: string
  segment: string
  position: string
  cp: CpLevel
  cpNote?: string
  desc: string
  note: string
  holding: boolean
  signals: ChainSignal[]
}

export interface ChainSegment {
  id: string
  order: number
  name: string
  role: string
  focus: string[]
  refs: string[]
}

export interface ChainDebate {
  topic: string
  bear: string
  bull: string
}

export interface Chain {
  version: number
  updated: string
  stage: string
  debates: ChainDebate[]
  segments: ChainSegment[]
  stocks: ChainStock[]
}

const CP_LEVELS: CpLevel[] = ["yes", "partial", "no"]
const SIGNAL_TYPES: SignalType[] = ["bullish", "bearish", "watch", "avoid"]
const SIGNAL_SOURCES: SignalSource[] = ["alan", "serenity", "taieo", "claude"]

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v)
}

/** 解析 ai-chain.json。字段做宽松归一而不是硬抛错:vault 侧手工维护,个别笔误不应整页挂掉。 */
export function parseChain(raw: string): Chain {
  const d = JSON.parse(raw) as Record<string, unknown>
  const g = (d.global ?? {}) as Record<string, unknown>

  const debates: ChainDebate[] = (Array.isArray(g.debates) ? g.debates : []).map((x) => {
    const o = x as Record<string, unknown>
    return { topic: str(o.topic), bear: str(o.bear), bull: str(o.bull) }
  })

  const segments: ChainSegment[] = (Array.isArray(d.segments) ? d.segments : [])
    .map((x) => {
      const o = x as Record<string, unknown>
      return {
        id: str(o.id),
        order: Number(o.order) || 0,
        name: str(o.name),
        role: str(o.role),
        focus: Array.isArray(o.focus) ? o.focus.map(str) : [],
        refs: Array.isArray(o.refs) ? o.refs.map(str) : [],
      }
    })
    .sort((a, b) => a.order - b.order)

  const stocks: ChainStock[] = (Array.isArray(d.stocks) ? d.stocks : []).map((x) => {
    const o = x as Record<string, unknown>
    const cpRaw = str(o.cp) as CpLevel
    const signals: ChainSignal[] = (Array.isArray(o.signals) ? o.signals : []).map((s) => {
      const so = s as Record<string, unknown>
      const type = str(so.type) as SignalType
      const source = str(so.source) as SignalSource
      return {
        date: str(so.date),
        source: SIGNAL_SOURCES.includes(source) ? source : "claude",
        type: SIGNAL_TYPES.includes(type) ? type : "watch",
        note: str(so.note),
        ref: so.ref ? str(so.ref) : undefined,
      }
    })
    return {
      ticker: str(o.ticker).toUpperCase(),
      name: str(o.name),
      segment: str(o.segment),
      position: str(o.position),
      cp: CP_LEVELS.includes(cpRaw) ? cpRaw : "no",
      cpNote: o.cpNote ? str(o.cpNote) : undefined,
      desc: str(o.desc),
      note: str(o.note),
      holding: o.holding === true,
      signals,
    }
  })

  return {
    version: Number(d.version) || 1,
    updated: str(d.updated),
    stage: str(g.stage),
    debates,
    segments,
    stocks,
  }
}

// ── 行情 ──

export interface Quote {
  price: number | null
  chg1d: number | null
  chg5d: number | null
  chg1m: number | null
  chgYtd: number | null
  mcap: number | null
}

export interface Quotes {
  updated: string
  quotes: Record<string, Quote>
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

export function parseQuotes(raw: string): Quotes {
  const d = JSON.parse(raw) as Record<string, unknown>
  const src = (d.quotes ?? {}) as Record<string, unknown>
  const quotes: Record<string, Quote> = {}
  for (const [ticker, v] of Object.entries(src)) {
    const o = v as Record<string, unknown>
    quotes[ticker.toUpperCase()] = {
      price: num(o.price),
      chg1d: num(o.chg1d),
      chg5d: num(o.chg5d),
      chg1m: num(o.chg1m),
      chgYtd: num(o.chgYtd),
      mcap: num(o.mcap),
    }
  }
  return { updated: str(d.updated), quotes }
}

// ── 格式化 ──

export function fmtPct(v: number | null): string {
  if (v == null) return "—"
  const sign = v > 0 ? "+" : ""
  return `${sign}${v.toFixed(1)}%`
}

export function fmtPrice(v: number | null): string {
  if (v == null) return "—"
  return v >= 1000 ? v.toFixed(0) : v.toFixed(2)
}

/** 市值缩写:4.7e12 → "4.7T",8.9e10 → "89B"。 */
export function fmtMcap(v: number | null): string {
  if (v == null || v <= 0) return ""
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)}T`
  if (v >= 1e10) return `${Math.round(v / 1e9)}B`
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  return `${Math.round(v / 1e6)}M`
}

/** CP 排序权重:是 → 部分 → 否(段内展示顺序,JSON 原序为同权 tiebreaker)。 */
export const CP_WEIGHT: Record<CpLevel, number> = { yes: 2, partial: 1, no: 0 }
