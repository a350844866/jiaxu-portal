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
  /** pm-live 真钱探针（state/live/，2026-09-14 点火）；目录/统计缺失 = null */
  live: PmLiveStatus | null
}

/**
 * pm-live 真钱探针状态（2026-09-28 加到首页）：模拟盘卡原先只读 paper，
 * 真钱探针 09-20 起 HALT 熔断在首页完全看不到。
 * 闩锁以 state/live/ 下的**文件**为准（executor 就是看文件拒跑的），stats.json 只是 10:15 的统计快照、会滞后。
 */
export interface PmLiveStatus {
  generatedAt: string | null
  ageSeconds: number | null
  /** stats.json 缺失或超过 PM_LIVE_STALE_SECONDS 未更新：计数与「运行中」都不可信 */
  stale: boolean
  mode: string | null
  armed: boolean
  /** 生效中的闩锁：HALT / TUITION_STOP / POST_BLOCKED / HASH_BROKEN / HALT(纸面) */
  latches: string[]
  nPosted: number
  nOpen: number
  nFilled: number
  nSettled: number
  realizedPnl: number
  collateralNow: number | null
  anomalies: number
}

interface LiveStatsFile {
  generated?: string
  mode?: string
  armed?: boolean
  halt?: boolean
  tuition_stop?: boolean
  post_blocked?: boolean
  hash_broken?: boolean
  n_posted?: number
  n_open?: number
  n_filled?: number
  n_settled?: number
  realized_pnl?: number
  collateral_now?: number
  anomalies?: unknown[]
}

const LIVE_LATCHES: Array<[file: string, key: keyof LiveStatsFile]> = [
  ["HALT", "halt"],
  ["TUITION_STOP", "tuition_stop"],
  ["POST_BLOCKED", "post_blocked"],
  ["HASH_BROKEN", "hash_broken"],
]

/** live/stats.json 由 live_settler 每天 10:15 写一次；超过 26h 没更新 = settler 断了，状态不可信 */
export const PM_LIVE_STALE_SECONDS = 26 * 3600

async function readLiveStatus(paperHalt: boolean): Promise<PmLiveStatus | null> {
  const [res, armedFile, ...latchFiles] = await Promise.all([
    readJsonFile<LiveStatsFile>("live/stats.json"),
    // 只查存在性（ARMED 是 600 权限，口令内容读不到也不该读）；撤掉 ARMED = 执行器不再发单
    fileExists("live/ARMED"),
    ...LIVE_LATCHES.map(([f]) => fileExists(`live/${f}`)),
  ])
  const st: LiveStatsFile = res.data ?? {}
  const latches = LIVE_LATCHES.filter(([, key], i) => latchFiles[i] || st[key] === true).map(([f]) => f)
  // 执行器 common.halted() 同时认纸面 state/HALT：纸面熔断也会让真钱探针停（反向不成立，live HALT 不串进纸面）
  if (paperHalt && !latches.includes("HALT")) latches.push("HALT(纸面)")
  // stats 缺失时，只要有闩锁文件仍要显示，否则整行消失反而掩盖了熔断（review 2026-09-28）
  if (!res.data && latches.length === 0) return null
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)
  const ageSeconds = res.mtimeMs != null ? Math.max(0, Math.round((Date.now() - res.mtimeMs) / 1000)) : null
  return {
    generatedAt: typeof st.generated === "string" ? st.generated : null,
    ageSeconds,
    stale: ageSeconds == null || ageSeconds > PM_LIVE_STALE_SECONDS,
    mode: typeof st.mode === "string" ? st.mode : null,
    // 只认严格布尔（"false" 字符串不能算点火），且 ARMED 文件必须还在
    armed: st.armed === true && armedFile,
    latches,
    nPosted: num(st.n_posted),
    nOpen: num(st.n_open),
    nFilled: num(st.n_filled),
    nSettled: num(st.n_settled),
    realizedPnl: num(st.realized_pnl),
    collateralNow: typeof st.collateral_now === "number" ? st.collateral_now : null,
    anomalies: Array.isArray(st.anomalies) ? st.anomalies.length : 0,
  }
}

// Resolved at call time (not module load) so tests can override PM_PAPER_STATE_DIR.
// Exported so pm-paper-detail-reader.ts (orders/predictions/settlements join layer)
// shares the exact same resolution instead of re-deriving it.
export function pmPaperStateDir(): string {
  return process.env.PM_PAPER_STATE_DIR || "/data/pm-paper/state"
}
const stateDir = pmPaperStateDir

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

  // 纸面熔断与卡片顶部横幅同一定义（文件 或 stats.overall.halt）
  const live = await readLiveStatus(haltFile || !!overall?.halt)

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
    live,
  }
}
