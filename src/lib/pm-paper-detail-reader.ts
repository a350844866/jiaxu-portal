/**
 * pm-paper full-detail dashboard reader (server-side fs I/O).
 *
 * Reuses readPmPaperSnapshot() for the shared header fields (bankroll/HALT/
 * overall calibration/cohorts) so the summary card and this detail page never
 * disagree about those numbers, then layers on the heavier join logic: order
 * event replay, latest-per-market predictions, fills-not-yet-settled, and the
 * settlements table.
 *
 * jsonl files are append-only and grow forever, so every jsonl read is capped
 * at MAX_JSONL_LINES (tail — most recent lines kept) before any parsing/join
 * work happens, bounding both read cost and response size.
 */
import { promises as fs } from "node:fs"
import path from "node:path"
import { readPmPaperSnapshot, pmPaperStateDir, type PmPaperSnapshot } from "./pm-paper-reader"
import {
  buildOpenOrderRows,
  buildPositionRows,
  buildPredictionRows,
  buildSettlementRows,
  type OrderEvent,
  type Prediction,
  type Fill,
  type Settlement,
  type UniverseMarket,
  type OpenOrderRow,
  type PositionRow,
  type PredictionRow,
  type SettlementRow,
} from "./pm-paper-detail-pure"

const MAX_JSONL_LINES = 5000

interface UniverseFile {
  updated?: string
  markets?: UniverseMarket[]
}

export interface TradeGate {
  n_settled_trades: number
  gate_n_target: number
  pnl: number
  roi_on_cost: number | null
  brier_claude: number | null
  brier_market: number | null
  politics_pnl: number
  politics_n: number
}

function normalizeTradeGate(raw: Partial<TradeGate> | undefined): TradeGate | null {
  if (!raw || typeof raw !== "object") return null
  return {
    n_settled_trades: Number(raw.n_settled_trades) || 0,
    gate_n_target: Number(raw.gate_n_target) || 30,
    pnl: Number(raw.pnl) || 0,
    roi_on_cost: raw.roi_on_cost == null ? null : Number(raw.roi_on_cost),
    brier_claude: raw.brier_claude == null ? null : Number(raw.brier_claude),
    brier_market: raw.brier_market == null ? null : Number(raw.brier_market),
    politics_pnl: Number(raw.politics_pnl) || 0,
    politics_n: Number(raw.politics_n) || 0,
  }
}

async function readJsonlCapped<T>(file: string, limit = MAX_JSONL_LINES): Promise<T[]> {
  try {
    const raw = await fs.readFile(path.join(pmPaperStateDir(), file), "utf-8")
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0)
    const tail = lines.length > limit ? lines.slice(-limit) : lines
    const out: T[] = []
    for (const line of tail) {
      try {
        out.push(JSON.parse(line) as T)
      } catch {
        // one malformed line shouldn't sink the whole read
      }
    }
    return out
  } catch {
    return []
  }
}

async function readJsonFile<T>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(path.join(pmPaperStateDir(), file), "utf-8")
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function buildUniverseMap(universeFile: UniverseFile | null): Map<string, UniverseMarket> {
  const map = new Map<string, UniverseMarket>()
  for (const m of universeFile?.markets ?? []) {
    if (m && typeof m === "object" && m.id != null) {
      map.set(String(m.id), m)
    }
  }
  return map
}

export interface PmPaperDetail extends PmPaperSnapshot {
  /** 上真钱门槛的权威口径 —— 只看已成交结算(30 单目标),与 overall(全预测校准,
   * 不要求成交)是两个不同的指标,页面上必须分开展示,不能混用。 */
  tradeGate: TradeGate | null
  openOrders: OpenOrderRow[]
  positions: PositionRow[]
  predictions: PredictionRow[]
  settlements: SettlementRow[]
}

export async function readPmPaperDetail(): Promise<PmPaperDetail> {
  const [snapshot, statsFile, universeFile, orders, predictions, fills, settlements] = await Promise.all([
    readPmPaperSnapshot(),
    readJsonFile<{ trade_gate?: Partial<TradeGate> }>("stats.json"),
    readJsonFile<UniverseFile>("universe.json"),
    readJsonlCapped<OrderEvent>("orders.jsonl"),
    readJsonlCapped<Prediction>("predictions.jsonl"),
    readJsonlCapped<Fill>("fills.jsonl"),
    readJsonlCapped<Settlement>("settlements.jsonl"),
  ])

  const universe = buildUniverseMap(universeFile)

  return {
    ...snapshot,
    tradeGate: normalizeTradeGate(statsFile?.trade_gate),
    openOrders: buildOpenOrderRows(orders, universe),
    positions: buildPositionRows(fills, settlements, universe),
    predictions: buildPredictionRows(predictions, universe),
    settlements: buildSettlementRows(settlements),
  }
}
