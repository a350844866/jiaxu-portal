/**
 * pm-scalp (Polymarket BTC 5-min 微结构实验) state reader.
 *
 * Reads the live artifacts written by /data/pm-scalp's two daemons
 * (recorder.py 秒级订单簿+Chainlink 采集, papertrader.py 模拟执行器)。
 * All reads are best-effort: missing/malformed files degrade to null
 * fields, never throw. See vault `pm-scalp微结构实验` for the experiment.
 *
 * File contracts:
 *   data/window-<ts>.jsonl — one file per 5-min window; meta line + 1 row/second
 *                            rows: { t, s, btc_b?, btc_a?, cl?, ub, ua, db, da, ... }
 *   paper/trades.jsonl     — append-only ledger; {type:"entry"|"settle", w, v, ...}
 *                            clean cl-only ledger since 2026-07-10 16:10 (+08)
 *   paper/heartbeat        — epoch seconds, touched ~15s by papertrader live loop
 */
import { promises as fs } from "node:fs"
import path from "node:path"

const VARIANT_META: Record<string, { label: string; mode: string }> = {
  N1: { label: "噪声回归 190-240s ≤3bps", mode: "taker" },
  N2: { label: "噪声回归 190-240s ≤6bps", mode: "taker" },
  N3: { label: "噪声回归 240-285s ≤3bps", mode: "taker" },
  N4: { label: "噪声回归 240-285s ≤6bps", mode: "taker" },
  M3: { label: "maker 对照 240-285s ≤3bps", mode: "maker" },
  P1: { label: "便士收割 ≤$0.02", mode: "taker" },
}

export interface PmScalpVariantStat {
  id: string
  label: string
  mode: string
  settled: number
  wins: number
  winrate: number | null
  pnl: number
  avgPerTrade: number | null
  /** 已结算投入(买入成本+手续费),盈利率分母 */
  settledCost: number
  /** 盈利率 = pnl / settledCost,无已结算时 null */
  roiOnCost: number | null
  open: number
}

export interface PmScalpTradeRow {
  w: number
  windowLabel: string
  v: string
  sideUp: boolean
  px: number
  disp: number | null
  s: number | null
  won: boolean | null // null = 未结算
  pnl: number | null
}

export interface PmScalpSnapshot {
  ok: boolean
  generatedAt: string
  /** 最新记录行距现在多少秒(记录器新鲜度) */
  dataAgeSeconds: number | null
  /** papertrader 心跳距现在多少秒 */
  heartbeatAgeSeconds: number | null
  windowsRecorded: number
  ledgerSince: string
  judgmentDate: string
  totals: { settled: number; wins: number; pnl: number; open: number; settledCost: number; roiOnCost: number | null }
  variants: PmScalpVariantStat[]
  openEntries: PmScalpTradeRow[]
  recentTrades: PmScalpTradeRow[]
  /** 最新一秒的 Chainlink vs 币安基差观测(仅展示,决策不使用币安) */
  basis: { cl: number; btc: number; usd: number; bps: number } | null
}

function scalpDir(): string {
  return process.env.PM_SCALP_DIR ?? "/data/pm-scalp"
}

function windowLabel(w: number): string {
  // 交易稀疏,最近 20 笔可能跨多天 — 带上日期,并显式 hour12(zh-CN 默认 hourCycle 在 ICU 版本间摇摆过)
  return new Date(w * 1000).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

interface LedgerEntry {
  type: "entry"
  w: number
  v: string
  side_up: boolean
  px: number
  sh: number
  fee: number
  s?: number
  disp?: number
}

interface LedgerSettle {
  type: "settle"
  w: number
  v: string
  won: boolean
  pnl: number
}

async function readLedger(): Promise<{ entries: LedgerEntry[]; settles: LedgerSettle[] }> {
  const entries: LedgerEntry[] = []
  const settles: LedgerSettle[] = []
  try {
    const raw = await fs.readFile(path.join(scalpDir(), "paper", "trades.jsonl"), "utf8")
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue
      try {
        const d = JSON.parse(line)
        if (d.type === "entry") entries.push(d)
        else if (d.type === "settle") settles.push(d)
      } catch {
        /* skip malformed line */
      }
    }
  } catch {
    /* ledger not created yet — zero trades is a valid state */
  }
  return { entries, settles }
}

async function readLatestWindow(): Promise<{
  dataAgeSeconds: number | null
  windowsRecorded: number
  basis: PmScalpSnapshot["basis"]
}> {
  let files: string[] = []
  try {
    files = (await fs.readdir(path.join(scalpDir(), "data"))).filter((f) =>
      /^window-\d+\.jsonl$/.test(f),
    )
  } catch {
    return { dataAgeSeconds: null, windowsRecorded: 0, basis: null }
  }
  if (files.length === 0) return { dataAgeSeconds: null, windowsRecorded: 0, basis: null }
  const latest = files.map((f) => Number(f.slice(7, -6))).sort((a, b) => b - a)[0]
  try {
    const raw = await fs.readFile(path.join(scalpDir(), "data", `window-${latest}.jsonl`), "utf8")
    const lines = raw.trimEnd().split("\n")
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const row = JSON.parse(lines[i])
        if (row.t == null) continue
        const dataAgeSeconds = Math.max(0, Math.round(Date.now() / 1000 - row.t / 1000))
        let basis: PmScalpSnapshot["basis"] = null
        if (row.cl != null && row.btc_b != null && row.btc_a != null) {
          const btcMid = (row.btc_b + row.btc_a) / 2
          basis = {
            cl: row.cl,
            btc: btcMid,
            usd: btcMid - row.cl,
            bps: ((btcMid - row.cl) / row.cl) * 1e4,
          }
        }
        return { dataAgeSeconds, windowsRecorded: files.length, basis }
      } catch {
        continue
      }
    }
  } catch {
    /* fallthrough */
  }
  return { dataAgeSeconds: null, windowsRecorded: files.length, basis: null }
}

async function readHeartbeat(): Promise<number | null> {
  try {
    const raw = await fs.readFile(path.join(scalpDir(), "paper", "heartbeat"), "utf8")
    const ts = Number(raw.trim())
    if (!Number.isFinite(ts) || ts <= 0) return null
    return Math.max(0, Math.round(Date.now() / 1000 - ts))
  } catch {
    return null
  }
}

export async function readPmScalpSnapshot(): Promise<PmScalpSnapshot> {
  const [{ entries, settles }, latestWin, heartbeatAgeSeconds] = await Promise.all([
    readLedger(),
    readLatestWindow(),
    readHeartbeat(),
  ])

  const settleKey = new Map<string, LedgerSettle>()
  for (const s of settles) settleKey.set(`${s.w}:${s.v}`, s)

  const byVariant = new Map<string, PmScalpVariantStat>()
  for (const [id, meta] of Object.entries(VARIANT_META)) {
    byVariant.set(id, {
      id,
      label: meta.label,
      mode: meta.mode,
      settled: 0,
      wins: 0,
      winrate: null,
      pnl: 0,
      avgPerTrade: null,
      settledCost: 0,
      roiOnCost: null,
      open: 0,
    })
  }

  const openEntries: PmScalpTradeRow[] = []
  const settledRows: PmScalpTradeRow[] = []
  const seenEntry = new Set<string>()
  for (const e of entries) {
    const entryKey = `${e.w}:${e.v}`
    if (seenEntry.has(entryKey)) continue
    seenEntry.add(entryKey)
    const stat =
      byVariant.get(e.v) ??
      ({ id: e.v, label: e.v, mode: "?", settled: 0, wins: 0, winrate: null, pnl: 0, avgPerTrade: null, settledCost: 0, roiOnCost: null, open: 0 } as PmScalpVariantStat)
    byVariant.set(e.v, stat)
    const settle = settleKey.get(`${e.w}:${e.v}`)
    const row: PmScalpTradeRow = {
      w: e.w,
      windowLabel: windowLabel(e.w),
      v: e.v,
      sideUp: e.side_up,
      px: e.px,
      disp: e.disp ?? null,
      s: e.s ?? null,
      won: settle ? settle.won : null,
      pnl: settle ? settle.pnl : null,
    }
    if (settle) {
      stat.settled += 1
      if (settle.won) stat.wins += 1
      stat.pnl += settle.pnl
      stat.settledCost += e.px * e.sh + e.fee
      settledRows.push(row)
    } else {
      stat.open += 1
      openEntries.push(row)
    }
  }
  for (const stat of byVariant.values()) {
    if (stat.settled > 0) {
      stat.winrate = stat.wins / stat.settled
      stat.avgPerTrade = stat.pnl / stat.settled
      stat.roiOnCost = stat.settledCost > 0 ? stat.pnl / stat.settledCost : null
    }
  }

  settledRows.sort((a, b) => b.w - a.w)
  openEntries.sort((a, b) => b.w - a.w)

  const totals = { settled: 0, wins: 0, pnl: 0, open: 0, settledCost: 0, roiOnCost: null as number | null }
  for (const s of byVariant.values()) {
    totals.settled += s.settled
    totals.wins += s.wins
    totals.pnl += s.pnl
    totals.open += s.open
    totals.settledCost += s.settledCost
  }
  if (totals.settledCost > 0) totals.roiOnCost = totals.pnl / totals.settledCost

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    dataAgeSeconds: latestWin.dataAgeSeconds,
    heartbeatAgeSeconds,
    windowsRecorded: latestWin.windowsRecorded,
    ledgerSince: "2026-07-10 16:10 (+08, cl-only 干净账本)",
    judgmentDate: "2026-07-17",
    totals,
    variants: [...byVariant.values()],
    openEntries: openEntries.slice(0, 12),
    recentTrades: settledRows.slice(0, 20),
    basis: latestWin.basis,
  }
}
