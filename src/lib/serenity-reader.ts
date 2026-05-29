import { promises as fs } from "node:fs"
import path from "node:path"

export type Stance = "新开" | "加码" | "持有" | "减仓" | "反手做空" | "转静默" | "观察"
export type Verdict = "兑现" | "落空" | "待核" | "不可证伪" | "归因不稳"

export interface Position {
  ticker: string
  name: string
  chain: string
  stance: Stance
  thesis: string
  instrument: string
  last_mention: string
  status: string
}

export interface Prediction {
  date: string
  claim: string
  falsifiable: string
  verdict: Verdict
  due: string | null
  note: string
}

export interface Catalyst {
  date: string
  event: string
  chain: string
}

export interface Ledger {
  updated: string
  last_distilled_ts: string
  self_reported: { ytd_pct: number; two_year_pct: number; as_of: string }
  positions: Position[]
  predictions: Prediction[]
  catalysts: Catalyst[]
}

const CORPUS_DIR = process.env.SERENITY_CORPUS_DIR || "/data/x-corpus"
const LEDGER_PATH = path.join(CORPUS_DIR, "ledger.json")

export function parseLikes(s: string): number {
  if (!s) return 0
  const m = /^([\d.]+)\s*([KM]?)$/i.exec(s.trim())
  if (!m) return 0
  const n = parseFloat(m[1])
  if (isNaN(n)) return 0
  const mult = m[2].toUpperCase() === "K" ? 1000 : m[2].toUpperCase() === "M" ? 1_000_000 : 1
  return Math.round(n * mult)
}

export function parseLedger(raw: string): Ledger {
  const o = JSON.parse(raw)
  return {
    updated: o.updated ?? "",
    last_distilled_ts: o.last_distilled_ts ?? "",
    self_reported: o.self_reported ?? { ytd_pct: 0, two_year_pct: 0, as_of: "" },
    positions: Array.isArray(o.positions) ? o.positions : [],
    predictions: Array.isArray(o.predictions) ? o.predictions : [],
    catalysts: Array.isArray(o.catalysts) ? o.catalysts : [],
  }
}

export async function readLedger(): Promise<
  { ok: true; ledger: Ledger; ageSeconds: number } | { ok: false; error: string }
> {
  try {
    const stat = await fs.stat(LEDGER_PATH)
    const raw = await fs.readFile(LEDGER_PATH, "utf-8")
    return { ok: true, ledger: parseLedger(raw), ageSeconds: Math.round((Date.now() - stat.mtimeMs) / 1000) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
