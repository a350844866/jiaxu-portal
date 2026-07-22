/**
 * pm-paper 事件快车道(event lane, Phase 1 shadow telemetry)dashboard reader.
 *
 * Reads /data/pm-paper/state/event/* written by event/watcher.py (cursor/caps/
 * candidates funnel), event/elane.sh (pcaps/event_predictions) and event/probe.py
 * (shadow_state/summary). All reads are tolerant: the lane launched 2026-07-22
 * and most files only appear after the first news trigger — missing files are a
 * normal "armed, waiting" state, not an error. jsonl reads are tail-capped like
 * pm-paper-detail-reader (append-only files grow forever).
 */
import { promises as fs } from "node:fs"
import path from "node:path"
import { pmPaperStateDir } from "./pm-paper-reader"

const MAX_JSONL_LINES = 3000
const TRIAGE_CAP = 24
const PREDICT_CAP = 8
const WATCHER_STALE_S = 35 * 60 // cron */10 — 3 missed beats + margin

export interface EventLegView {
  status: string
  fillPx: number | null
}

export interface EventPositionRow {
  predictionId: string
  marketQuestion: string | null
  side: "YES" | "NO"
  p: number
  execMid: number | null
  latencyOk: boolean
  t0: number
  legs: Record<string, EventLegView>
  mtm6h: number | null // taker0 leg MTM at the 6h mark, $ per $100 notional
  mtm24h: number | null
  settledWon: boolean | null
}

export interface PairedBlock {
  n: number
  mean: number
  ci95: [number, number] | null
}

export interface EventLaneView {
  present: boolean // event dir exists (lane deployed)
  watcherAgeSeconds: number | null // cursor.json mtime age = heartbeat
  watcherStale: boolean
  summaryAgeSeconds: number | null
  capsToday: { triage: number; triageCap: number; predict: number; predictCap: number }
  funnelTotal: Record<string, number>
  funnelToday: Record<string, number>
  positions: EventPositionRow[]
  paired: Record<string, Record<string, PairedBlock>> // subset -> endpoint -> block
  settled: { n: number; taker0PnlSum: number } | null
  predictionsCount: number
}

function eventDir(): string {
  return path.join(pmPaperStateDir(), "event")
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch {
    return null
  }
}

async function readJsonlTail(file: string): Promise<Record<string, unknown>[]> {
  let raw: string
  try {
    raw = await fs.readFile(file, "utf8")
  } catch {
    return []
  }
  const lines = raw.split("\n").filter((l) => l.trim())
  const out: Record<string, unknown>[] = []
  for (const line of lines.slice(-MAX_JSONL_LINES)) {
    try {
      out.push(JSON.parse(line) as Record<string, unknown>)
    } catch {
      // torn tail line while a writer appends — skip, next refresh sees it whole
    }
  }
  return out
}

async function mtimeAge(file: string, now: number): Promise<number | null> {
  try {
    const st = await fs.stat(file)
    return Math.max(0, Math.floor(now - st.mtimeMs / 1000))
  } catch {
    return null
  }
}

function legMtm(
  leg: { status?: string; shares?: number } | undefined,
  mark: { side_mid?: number | null } | null | undefined,
): number | null {
  if (!leg || leg.status !== "filled" || typeof leg.shares !== "number") return null
  const mid = mark?.side_mid
  if (mid == null) return null
  return Math.round((leg.shares * mid - 100) * 100) / 100
}

interface ShadowLeg {
  status?: string
  fill_px?: number
  shares?: number
}
interface ShadowPos {
  prediction_id?: string
  market_id?: string
  side?: "YES" | "NO"
  p?: number
  t0?: number
  latency_ok?: boolean
  snap0?: { mid?: number | null }
  legs?: Record<string, ShadowLeg>
  marks?: Record<string, { side_mid?: number | null } | null>
  settled?: { won?: boolean } | null
}
interface SummaryFile {
  updated?: number
  paired?: Record<string, Record<string, { n: number; mean: number; ci95_cluster?: [number, number] | null }>>
  settled?: { n: number; taker0_pnl_sum: number }
}

export async function readEventLane(): Promise<EventLaneView> {
  const dir = eventDir()
  const now = Date.now() / 1000
  try {
    await fs.access(dir)
  } catch {
    return emptyView(false)
  }

  const [summary, caps, pcaps, shadowState, cursorAge, summaryAge, candidates, predictions, universe] =
    await Promise.all([
      readJson<SummaryFile>(path.join(dir, "summary.json")),
      readJson<Record<string, { triage?: number }>>(path.join(dir, "caps.json")),
      readJson<Record<string, number>>(path.join(dir, "pcaps.json")),
      readJson<{ positions?: Record<string, ShadowPos> }>(path.join(dir, "shadow_state.json")),
      mtimeAge(path.join(dir, "cursor.json"), now),
      mtimeAge(path.join(dir, "summary.json"), now),
      readJsonlTail(path.join(dir, "candidates.jsonl")),
      readJsonlTail(path.join(dir, "event_predictions.jsonl")),
      readJson<{ markets?: { id: string; question?: string }[] }>(
        path.join(pmPaperStateDir(), "universe.json"),
      ),
    ])

  // caps use the writer's local date keys (Asia/Shanghai on the home server)
  const todayKey = new Date(now * 1000).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" })
  const startOfToday = new Date(`${todayKey}T00:00:00+08:00`).getTime() / 1000

  const funnelTotal: Record<string, number> = {}
  const funnelToday: Record<string, number> = {}
  for (const row of candidates) {
    const stage = typeof row.stage === "string" ? row.stage : "unknown"
    funnelTotal[stage] = (funnelTotal[stage] ?? 0) + 1
    if (typeof row.ts === "number" && row.ts >= startOfToday) {
      funnelToday[stage] = (funnelToday[stage] ?? 0) + 1
    }
  }

  const questionByMarket = new Map<string, string>()
  for (const m of universe?.markets ?? []) {
    if (m.id && m.question) questionByMarket.set(String(m.id), m.question)
  }

  const positions: EventPositionRow[] = Object.values(shadowState?.positions ?? {})
    .filter((p): p is ShadowPos => Boolean(p && p.prediction_id))
    .sort((a, b) => (b.t0 ?? 0) - (a.t0 ?? 0))
    .slice(0, 20)
    .map((p) => {
      const legs: Record<string, EventLegView> = {}
      for (const [name, leg] of Object.entries(p.legs ?? {})) {
        legs[name] = { status: leg.status ?? "?", fillPx: leg.fill_px ?? null }
      }
      return {
        predictionId: p.prediction_id as string,
        marketQuestion: questionByMarket.get(String(p.market_id)) ?? null,
        side: p.side ?? "YES",
        p: p.p ?? 0,
        execMid: p.snap0?.mid ?? null,
        latencyOk: Boolean(p.latency_ok),
        t0: p.t0 ?? 0,
        legs,
        mtm6h: legMtm(p.legs?.taker0, p.marks?.mtm6h),
        mtm24h: legMtm(p.legs?.taker0, p.marks?.mtm24h),
        settledWon: p.settled == null ? null : Boolean(p.settled.won),
      }
    })

  const paired: EventLaneView["paired"] = {}
  for (const [subset, blocks] of Object.entries(summary?.paired ?? {})) {
    paired[subset] = {}
    for (const [endpoint, b] of Object.entries(blocks)) {
      paired[subset][endpoint] = { n: b.n, mean: b.mean, ci95: b.ci95_cluster ?? null }
    }
  }

  return {
    present: true,
    watcherAgeSeconds: cursorAge,
    watcherStale: cursorAge == null || cursorAge > WATCHER_STALE_S,
    summaryAgeSeconds: summaryAge,
    capsToday: {
      triage: caps?.[todayKey]?.triage ?? 0,
      triageCap: TRIAGE_CAP,
      predict: pcaps?.[todayKey] ?? 0,
      predictCap: PREDICT_CAP,
    },
    funnelTotal,
    funnelToday,
    positions,
    paired,
    settled: summary?.settled
      ? { n: summary.settled.n, taker0PnlSum: summary.settled.taker0_pnl_sum }
      : null,
    predictionsCount: predictions.length,
  }
}

function emptyView(present: boolean): EventLaneView {
  return {
    present,
    watcherAgeSeconds: null,
    watcherStale: true,
    summaryAgeSeconds: null,
    capsToday: { triage: 0, triageCap: TRIAGE_CAP, predict: 0, predictCap: PREDICT_CAP },
    funnelTotal: {},
    funnelToday: {},
    positions: [],
    paired: {},
    settled: null,
    predictionsCount: 0,
  }
}
