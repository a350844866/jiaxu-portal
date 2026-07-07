/**
 * pm-paper (Polymarket paper-trading 模拟盘) state reader.
 *
 * Reads the state snapshot written by /data/pm-paper's cron pipeline
 * (selector → predictor → executor → settler). All files are optional —
 * the system was just deployed and stats.json / bankroll.json may not
 * exist yet ("实验第0周，等待首轮数据"). Every read is best-effort:
 * missing/malformed files degrade to null fields, never throw.
 *
 * File contracts (see /data/pm-paper docs + vault `Polymarket模拟盘系统`):
 *   state/stats.json       — { generated, bankroll, overall, cohorts:{politics,data}, calibration }
 *   state/bankroll.json    — { ts, committed, available } (not yet written by settler as of 2026-07-07)
 *   state/universe.json    — { updated, markets: [...] }
 *   state/predictions.jsonl— one prediction record per line (append-only)
 *   state/HALT             — sentinel file; presence = 30% drawdown circuit breaker tripped
 */
import { promises as fs } from "node:fs"
import path from "node:path"

export interface CohortStats {
  n_settled_predictions: number
  n_settled_positions: number
  pnl: number
  roi_on_cost: number | null
  brier_claude: number | null
  brier_market: number | null
  n_open_orders?: number
  n_fills_total?: number
  halt?: boolean
}

export interface CalibrationBucket {
  bucket: string | number
  n: number
  p_mean: number
  outcome_rate: number
}

interface StatsFile {
  generated?: string
  bankroll?: number
  overall?: Partial<CohortStats>
  cohorts?: Record<string, Partial<CohortStats>>
  calibration?: CalibrationBucket[]
}

interface BankrollFile {
  ts?: string
  committed?: number
  available?: number
}

interface UniverseFile {
  updated?: string
  markets?: unknown[]
}

export interface PmPaperSnapshot {
  ok: true
  /** true when stats.json doesn't exist yet and nothing has been predicted — "实验第0周" */
  bootstrapping: boolean
  generatedAt: string | null
  ageSeconds: number | null
  halt: boolean
  bankroll: number | null
  committed: number | null
  available: number | null
  universeCount: number | null
  universeUpdated: string | null
  predictionsCount: number
  overall: CohortStats | null
  cohorts: {
    politics: CohortStats | null
    data: CohortStats | null
  }
  calibration: CalibrationBucket[]
}

// Resolved at call time (not module load) so tests can override PM_PAPER_STATE_DIR.
function stateDir(): string {
  return process.env.PM_PAPER_STATE_DIR || "/data/pm-paper/state"
}

function normalizeCohort(raw: Partial<CohortStats> | undefined): CohortStats | null {
  if (!raw || typeof raw !== "object") return null
  return {
    n_settled_predictions: Number(raw.n_settled_predictions) || 0,
    n_settled_positions: Number(raw.n_settled_positions) || 0,
    pnl: Number(raw.pnl) || 0,
    roi_on_cost: raw.roi_on_cost == null ? null : Number(raw.roi_on_cost),
    brier_claude: raw.brier_claude == null ? null : Number(raw.brier_claude),
    brier_market: raw.brier_market == null ? null : Number(raw.brier_market),
    n_open_orders: raw.n_open_orders == null ? undefined : Number(raw.n_open_orders),
    n_fills_total: raw.n_fills_total == null ? undefined : Number(raw.n_fills_total),
    halt: !!raw.halt,
  }
}

async function readJsonFile<T>(file: string): Promise<{ data: T | null; mtimeMs: number | null }> {
  try {
    const p = path.join(stateDir(), file)
    const stat = await fs.stat(p)
    const raw = await fs.readFile(p, "utf-8")
    return { data: JSON.parse(raw) as T, mtimeMs: stat.mtimeMs }
  } catch {
    return { data: null, mtimeMs: null }
  }
}

async function countJsonlLines(file: string): Promise<number> {
  try {
    const raw = await fs.readFile(path.join(stateDir(), file), "utf-8")
    return raw.split(/\r?\n/).filter((l) => l.trim().length > 0).length
  } catch {
    return 0
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(path.join(stateDir(), file))
    return true
  } catch {
    return false
  }
}

export async function readPmPaperSnapshot(): Promise<PmPaperSnapshot> {
  const [statsRes, bankrollRes, universeRes, predictionsCount, haltFile] = await Promise.all([
    readJsonFile<StatsFile>("stats.json"),
    readJsonFile<BankrollFile>("bankroll.json"),
    readJsonFile<UniverseFile>("universe.json"),
    countJsonlLines("predictions.jsonl"),
    fileExists("HALT"),
  ])

  const stats = statsRes.data
  const bankrollFile = bankrollRes.data
  const universe = universeRes.data

  const overall = normalizeCohort(stats?.overall)
  const cohorts = {
    politics: normalizeCohort(stats?.cohorts?.politics),
    data: normalizeCohort(stats?.cohorts?.data),
  }

  const bootstrapping = !stats && !universe && predictionsCount === 0

  const generatedAt =
    stats?.generated ?? (statsRes.mtimeMs != null ? new Date(statsRes.mtimeMs).toISOString() : null)
  const ageSeconds =
    statsRes.mtimeMs != null ? Math.max(0, Math.round((Date.now() - statsRes.mtimeMs) / 1000)) : null

  return {
    ok: true,
    bootstrapping,
    generatedAt,
    ageSeconds,
    halt: haltFile || !!overall?.halt,
    bankroll: stats?.bankroll == null ? null : Number(stats.bankroll),
    committed: bankrollFile?.committed == null ? null : Number(bankrollFile.committed),
    available: bankrollFile?.available == null ? null : Number(bankrollFile.available),
    universeCount: Array.isArray(universe?.markets) ? universe!.markets!.length : null,
    universeUpdated: universe?.updated ?? null,
    predictionsCount,
    overall,
    cohorts,
    calibration: Array.isArray(stats?.calibration) ? stats!.calibration! : [],
  }
}
