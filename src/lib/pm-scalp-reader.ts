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

/** 当前诚实执行模型版本 — v5 = 2026-07-12 深夜 tick 纪元(ticksim 关窗回放,
 *  papertrader 已退役;账本由 paper/windows-v5/ 工件重建,行内含结算) */
const CURRENT_EXEC = 5

const VARIANT_META: Record<string, { label: string; mode: string }> = {
  N1: { label: "噪声回归 190-240s ≤3bps", mode: "taker" },
  N2: { label: "噪声回归 190-240s ≤6bps", mode: "taker" },
  N3: { label: "噪声回归 240-285s ≤3bps", mode: "taker" },
  N4: { label: "噪声回归 240-285s ≤6bps", mode: "taker" },
  N4B: { label: "band 0.40-0.48(=实盘批次2配置)", mode: "taker" },
  M3: { label: "maker 对照 240-285s ≤3bps", mode: "maker" },
  M3B: { label: "maker+band 0.40-0.48(实盘候选)", mode: "maker" },
  N0: { label: "无位移过滤对照 240-285s", mode: "taker" },
  P1: { label: "便士收割 ≤$0.02", mode: "taker" },
  F1: { label: "热门动量 180-270s ≥8bps 买领先侧", mode: "taker" },
  E1: { label: "早段失真+8c反弹卖出(原始版)", mode: "taker" },
  B1a: { label: "双边锁定·腿1(落后侧≤.44)", mode: "taker" },
  B1b: { label: "双边锁定·腿2(合计≤.97)", mode: "taker" },
  B1S: { label: "B1b单飞·影子腿报信裸买对侧(前向専用)", mode: "taker" },
  VN1: { label: "终局·波动率归一价值 s282(前向専用)", mode: "taker" },
  C1: { label: "终局收敛·护栏版 s282-292(前向専用)", mode: "taker" },
  "C1-T1000": { label: "终局收敛·tick原生 T=1000ms(primary,冻结)", mode: "taker" },
  "C1-T500": { label: "终局收敛·tick原生 T=500ms(exploratory)", mode: "taker" },
  C1M: { label: "终局收敛·maker实验(3s TTL,前向専用)", mode: "maker" },
  A1a: { label: "交叉盘套利·Up腿", mode: "taker" },
  A1b: { label: "交叉盘套利·Down腿", mode: "taker" },
}

/** 单一执行模型时代的统计切片(全时代 or 仅 v3 诚实模型) */
export interface EraStat {
  settled: number
  wins: number
  winrate: number | null
  pnl: number
  avgPerTrade: number | null
  /** 已结算投入(买入成本+手续费),盈利率分母 */
  settledCost: number
  /** 盈利率 = pnl / settledCost,无已结算时 null */
  roiOnCost: number | null
}

function emptyEra(): EraStat {
  return { settled: 0, wins: 0, winrate: null, pnl: 0, avgPerTrade: null, settledCost: 0, roiOnCost: null }
}

function finalizeEra(e: EraStat): void {
  if (e.settled > 0) {
    e.winrate = e.wins / e.settled
    e.avgPerTrade = e.pnl / e.settled
    e.roiOnCost = e.settledCost > 0 ? e.pnl / e.settledCost : null
  }
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
  /** 仅当前诚实执行模型(CURRENT_EXEC)的切片 */
  v3: EraStat
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
  /** 仅当前诚实模型(CURRENT_EXEC)的合计(判定日应以此为准) */
  totalsV3: EraStat
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
  /** 执行模型版本;4 = 2026-07-12 起 GTC-到窗尾视界(61 笔真金验证 60/61 一致) */
  exec?: number
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
        if (d.exec === 5 && d.type === "entry") {
          // v5 tick 纪元:行内含结算(settle 字段),nofill/unusable 没有 px/sh —
          // 只把 settled(成 entry+settle 对)与 pending(成 open entry,px=限价)
          // 映射进 v4 页面契约;nofill/unusable_window 不是持仓,跳过
          if (d.settle === "settled") {
            entries.push({ type: "entry", w: d.w, v: d.v, side_up: d.side_up,
              px: d.px, sh: d.sh, fee: d.fee, s: d.s, exec: 5 })
            settles.push({ type: "settle", w: d.w, v: d.v, won: d.won, pnl: d.net })
          } else if (d.settle === "pending") {
            entries.push({ type: "entry", w: d.w, v: d.v, side_up: d.side_up,
              px: d.limit, sh: 5, fee: 0, s: d.s, exec: 5 })
          }
        } else if (d.type === "entry") entries.push(d)
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
  // v5: papertrader(与其 heartbeat 文件)已退役 — 活性 = 最新关窗工件 mtime
  // (cron runner 每 2min 扫,健康时新工件滞后关窗 <5min)
  try {
    const dir = path.join(scalpDir(), "paper", "windows-v5")
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".v5.json"))
    if (files.length === 0) return null
    let newest = 0
    for (const f of files) {
      const st = await fs.stat(path.join(dir, f))
      if (st.mtimeMs > newest) newest = st.mtimeMs
    }
    return Math.max(0, Math.round((Date.now() - newest) / 1000))
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
      v3: emptyEra(),
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
      ({ id: e.v, label: e.v, mode: "?", settled: 0, wins: 0, winrate: null, pnl: 0, avgPerTrade: null, settledCost: 0, roiOnCost: null, open: 0, v3: emptyEra() } as PmScalpVariantStat)
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
      const cost = e.px * e.sh + e.fee
      stat.settled += 1
      if (settle.won) stat.wins += 1
      stat.pnl += settle.pnl
      stat.settledCost += cost
      if (e.exec === CURRENT_EXEC) {
        stat.v3.settled += 1
        if (settle.won) stat.v3.wins += 1
        stat.v3.pnl += settle.pnl
        stat.v3.settledCost += cost
      }
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
    finalizeEra(stat.v3)
  }

  settledRows.sort((a, b) => b.w - a.w)
  openEntries.sort((a, b) => b.w - a.w)

  // 配对腿合并显示:两条腿是同一策略的两半,分行显示会造出"半场比分"假象
  // (B1b 曾因此被误读为全场最佳)。合并行只报净额;腿级胜率无意义(锁定对必一赢一输)
  // 故 winrate=null;逐单明细表仍保留分腿记录。
  const PAIRS: Record<string, { legs: [string, string]; label: string; mode: string }> = {
    B1: { legs: ["B1a", "B1b"], label: "双边锁定·配对净额(先买后补,腿见明细)", mode: "pair" },
    A1: { legs: ["A1a", "A1b"], label: "交叉盘套利·配对净额(同秒双腿)", mode: "pair" },
    SL1: { legs: ["SL1a", "SL1b"], label: "瞬时双锁·配对净额(同秒,费后门控)", mode: "pair" },
  }
  const mergeEra = (a: EraStat, b: EraStat): EraStat => {
    const settled = Math.max(a.settled, b.settled)
    const pnl = a.pnl + b.pnl
    const settledCost = a.settledCost + b.settledCost
    return {
      settled,
      wins: 0,
      winrate: null,
      pnl,
      avgPerTrade: settled > 0 ? pnl / settled : null,
      settledCost,
      roiOnCost: settledCost > 0 ? pnl / settledCost : null,
    }
  }
  for (const [pid, cfg] of Object.entries(PAIRS)) {
    const a = byVariant.get(cfg.legs[0])
    const b = byVariant.get(cfg.legs[1])
    if (!a || !b) continue
    const merged: PmScalpVariantStat = {
      id: pid,
      label: cfg.label,
      mode: cfg.mode,
      ...mergeEra(a, b),
      open: a.open + b.open,
      v3: mergeEra(a.v3, b.v3),
    }
    byVariant.delete(cfg.legs[0])
    byVariant.delete(cfg.legs[1])
    byVariant.set(pid, merged)
  }

  const totals = { settled: 0, wins: 0, pnl: 0, open: 0, settledCost: 0, roiOnCost: null as number | null }
  const totalsV3 = emptyEra()
  for (const s of byVariant.values()) {
    totals.settled += s.settled
    totals.wins += s.wins
    totals.pnl += s.pnl
    totals.open += s.open
    totals.settledCost += s.settledCost
    totalsV3.settled += s.v3.settled
    totalsV3.wins += s.v3.wins
    totalsV3.pnl += s.v3.pnl
    totalsV3.settledCost += s.v3.settledCost
  }
  if (totals.settledCost > 0) totals.roiOnCost = totals.pnl / totals.settledCost
  finalizeEra(totalsV3)

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    dataAgeSeconds: latestWin.dataAgeSeconds,
    heartbeatAgeSeconds,
    windowsRecorded: latestWin.windowsRecorded,
    ledgerSince: "2026-07-13 (+08, v5 tick 纪元;headline=1500ms 悲观口径;v4 及更早账已归档)",
    judgmentDate: "2026-07-17",
    totals,
    totalsV3,
    // v5 纪元只带 4 幸存者 — 旧纪元变体(N 族/M3/P1/F1/E1/B1/A1/SL1)在当前
    // 账本里零活动,不再渲染空行;它们的结论与归档见 vault pm-scalp 页
    variants: [...byVariant.values()].filter(
      (v) => v.settled > 0 || v.open > 0 || v.v3.settled > 0,
    ),
    openEntries: openEntries.slice(0, 12),
    recentTrades: settledRows.slice(0, 20),
    basis: latestWin.basis,
  }
}
