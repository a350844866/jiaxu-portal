import mysql from "mysql2/promise"
import Database from "better-sqlite3"
import path from "path"
import fs from "fs"
import os from "os"

let pool: mysql.Pool | null = null

function getPool(): mysql.Pool {
  if (pool) return pool
  pool = mysql.createPool({
    host: process.env.USAGE_DB_HOST || "host.docker.internal",
    port: Number(process.env.USAGE_DB_PORT || 3306),
    user: process.env.USAGE_DB_USER || "claude_usage",
    password: process.env.USAGE_DB_PASS || "",
    database: process.env.USAGE_DB_NAME || "claude_usage",
    connectionLimit: 4,
    waitForConnections: true,
    enableKeepAlive: true,
  })
  return pool
}

// --- 北京时间 (UTC+8) 时间边界 ---

/** 北京时间今日 00:00 对应的 UTC 时间 */
function beijingTodayUtc(): Date {
  const now = new Date()
  // 北京时间 = UTC + 8h，取日期部分再减回 8h 得到 UTC 时刻
  const bjNow = new Date(now.getTime() + 8 * 3600_000)
  const dateStr = bjNow.toISOString().slice(0, 10) // YYYY-MM-DD in Beijing
  return new Date(dateStr + "T00:00:00+08:00")
}

/** 北京时间本月 1 日 00:00 对应的 UTC 时间 */
function beijingMonthStartUtc(): Date {
  const now = new Date()
  const bjNow = new Date(now.getTime() + 8 * 3600_000)
  const monthStr = bjNow.toISOString().slice(0, 7) // YYYY-MM
  return new Date(monthStr + "-01T00:00:00+08:00")
}

/**
 * Claude Pro 最近一次周重置时刻（UTC）。
 * 重置点：每周日 11:00 北京时间 = 周日 03:00 UTC。
 */
function weeklyResetUtc(): Date {
  const now = new Date()
  const d = new Date(now)
  // getUTCDay: 0=Sun, 1=Mon, ..., 6=Sat
  const daysSinceSun = d.getUTCDay()
  d.setUTCDate(d.getUTCDate() - daysSinceSun)
  d.setUTCHours(3, 0, 0, 0) // Sun 03:00 UTC = Sun 11:00 Beijing
  // 如果算出来是未来（今天是周日但还没到 03:00 UTC），退 7 天
  if (d.getTime() > now.getTime()) {
    d.setUTCDate(d.getUTCDate() - 7)
  }
  return d
}

/**
 * Codex (OpenAI Plus) 最近一次周重置时刻（UTC），独立于 Claude。
 * 锚点: 2026-04-22 23:17 北京时间 = 2026-04-22T15:17:00Z (用户实际观测到的下次重置)。
 * 滚动 7 天窗口：向锚点前后外推，取 now 之前最近的一次。
 */
function codexWeeklyResetUtc(): Date {
  const anchor = new Date("2026-04-22T15:17:00Z")
  const now = new Date()
  const weekMs = 7 * 24 * 3600 * 1000
  const weeksPassed = Math.floor((now.getTime() - anchor.getTime()) / weekMs)
  return new Date(anchor.getTime() + weeksPassed * weekMs)
}

export type SystemName = "mt4" | "ibkr" | "quant-flow" | "auto-content" | "interactive" | "other" | "mbp"

export interface SystemSummary {
  system: SystemName
  today_input: number
  today_output: number
  today_cache_read: number
  today_cache_create: number
  today_cost_usd: number
  today_total_tokens: number
  month_cost_usd: number
  last1h_cost_usd: number
  last1h_total_tokens: number
  last_event_ts: string | null
}

export interface UsageLive {
  as_of: string
  systems: SystemSummary[]
  totals: {
    today_cost_usd: number
    today_total_tokens: number
    month_cost_usd: number
    last1h_total_tokens: number
  }
}

const ALL_SYSTEMS: SystemName[] = ["mt4", "ibkr", "quant-flow", "auto-content", "interactive", "other"]

interface QuantFlowTracerEntry {
  ts: number
  provider: string
  model: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cost_usd: number
  success: boolean
}

function toNumber(value: unknown): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

function formatUtcYmd(date: Date): string {
  const year = String(date.getUTCFullYear())
  const month = String(date.getUTCMonth() + 1).padStart(2, "0")
  const day = String(date.getUTCDate()).padStart(2, "0")
  return `${year}${month}${day}`
}

/** 读取 quant-flow tracer JSONL（按日期文件 glob），过滤 success=true。*/
function listQuantFlowTracerEntries(sinceEpoch: number): QuantFlowTracerEntry[] {
  const tracerDir = process.env.QUANT_FLOW_LLM_CALLS_PATH || "/data/quant-flow-llm-calls"
  try {
    if (!fs.existsSync(tracerDir)) return []

    // 文件名按日期切分，向前多取一天避免 UTC/本地时区边界导致漏读。
    const minFileYmd = formatUtcYmd(new Date((sinceEpoch - 86400) * 1000))
    const fileNames = fs.readdirSync(tracerDir)
      .filter((name) => /^llm_calls_\d{8}\.jsonl$/.test(name))
      .sort()

    const entries: QuantFlowTracerEntry[] = []
    for (const fileName of fileNames) {
      const match = /^llm_calls_(\d{8})\.jsonl$/.exec(fileName)
      if (!match || match[1] < minFileYmd) continue

      const content = fs.readFileSync(path.join(tracerDir, fileName), "utf-8")
      const lines = content.split("\n").filter(Boolean)
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line)
          const tsMs = Date.parse(String(parsed.timestamp || ""))
          const ts = Number.isFinite(tsMs) ? Math.floor(tsMs / 1000) : 0
          if (parsed.success !== true || ts < sinceEpoch) continue

          entries.push({
            ts,
            provider: String(parsed.provider || ""),
            model: String(parsed.model || ""),
            prompt_tokens: toNumber(parsed.prompt_tokens),
            completion_tokens: toNumber(parsed.completion_tokens),
            total_tokens: toNumber(parsed.total_tokens),
            cost_usd: toNumber(parsed.cost_usd),
            success: true,
          })
        } catch {
          // ignore malformed JSONL lines
        }
      }
    }

    return entries
  } catch {
    return []
  }
}

interface BucketUsageSummary {
  today_input: number
  today_output: number
  today_cost_usd: number
  today_total_tokens: number
  month_cost_usd: number
  last1h_cost_usd: number
  last1h_total_tokens: number
  last_event_ts: string | null
}

function emptyBucketUsageSummary(): BucketUsageSummary {
  return {
    today_input: 0,
    today_output: 0,
    today_cost_usd: 0,
    today_total_tokens: 0,
    month_cost_usd: 0,
    last1h_cost_usd: 0,
    last1h_total_tokens: 0,
    last_event_ts: null,
  }
}

function mergeBucketUsage(target: SystemSummary, extra: BucketUsageSummary): void {
  target.today_input += extra.today_input
  target.today_output += extra.today_output
  target.today_cost_usd += extra.today_cost_usd
  target.today_total_tokens += extra.today_total_tokens
  target.month_cost_usd += extra.month_cost_usd
  target.last1h_cost_usd += extra.last1h_cost_usd
  target.last1h_total_tokens += extra.last1h_total_tokens
  if (extra.last_event_ts && (!target.last_event_ts || extra.last_event_ts > target.last_event_ts)) {
    target.last_event_ts = extra.last_event_ts
  }
}

function summarizeQuantFlowTracer(entries: QuantFlowTracerEntry[]): BucketUsageSummary {
  const todayEpoch = Math.floor(beijingTodayUtc().getTime() / 1000)
  const monthEpoch = Math.floor(beijingMonthStartUtc().getTime() / 1000)
  const hourAgoEpoch = Math.floor((Date.now() - 3600_000) / 1000)
  const acc = emptyBucketUsageSummary()

  let maxTs = 0
  for (const entry of entries) {
    // claude_headless / codex_headless 已在调用方过滤掉（各自有权威源：MySQL watcher /
    // Codex SQLite sessions），这里剩下的都是 deepseek / qwen 等按量 provider，
    // tracer 写入的 cost_usd 就是真实 API 成本。
    const cost = entry.cost_usd

    if (entry.ts >= monthEpoch) {
      acc.month_cost_usd += cost
    }
    if (entry.ts >= todayEpoch) {
      acc.today_input += entry.prompt_tokens
      acc.today_output += entry.completion_tokens
      acc.today_cost_usd += cost
      acc.today_total_tokens += entry.total_tokens
    }
    if (entry.ts >= hourAgoEpoch) {
      acc.last1h_cost_usd += cost
      acc.last1h_total_tokens += entry.total_tokens
    }
    if (entry.ts > maxTs) maxTs = entry.ts
  }

  acc.last_event_ts = maxTs > 0 ? new Date(maxTs * 1000).toISOString() : null
  return acc
}

/** 把某个 host 的多 system_name 行聚合成单个 SystemSummary（用于 MBP 卡）。*/
function buildHostSummary(rows: mysql.RowDataPacket[], host: SystemName): SystemSummary {
  const acc: SystemSummary = {
    system: host,
    today_input: 0,
    today_output: 0,
    today_cache_read: 0,
    today_cache_create: 0,
    today_cost_usd: 0,
    today_total_tokens: 0,
    month_cost_usd: 0,
    last1h_cost_usd: 0,
    last1h_total_tokens: 0,
    last_event_ts: null,
  }
  for (const r of rows) {
    acc.today_input += toNumber(r.today_input)
    acc.today_output += toNumber(r.today_output)
    acc.today_cache_read += toNumber(r.today_cache_read)
    acc.today_cache_create += toNumber(r.today_cache_create)
    acc.today_cost_usd += toNumber(r.today_cost_usd)
    acc.month_cost_usd += toNumber(r.month_cost_usd)
    acc.last1h_cost_usd += toNumber(r.last1h_cost_usd)
    acc.last1h_total_tokens += toNumber(r.last1h_total_tokens)
    const ts = r.last_event_ts
      ? new Date(r.last_event_ts as string | Date).toISOString()
      : null
    if (ts && (!acc.last_event_ts || ts > acc.last_event_ts)) acc.last_event_ts = ts
  }
  acc.today_total_tokens =
    acc.today_input + acc.today_output + acc.today_cache_read + acc.today_cache_create
  return acc
}

export async function getUsageLive(): Promise<UsageLive> {
  const p = getPool()
  const todayUtc = beijingTodayUtc().toISOString().slice(0, 19).replace("T", " ")
  const monthUtc = beijingMonthStartUtc().toISOString().slice(0, 19).replace("T", " ")
  const [rows] = await p.query<mysql.RowDataPacket[]>(
    `
    SELECT
      system_name,
      host,
      SUM(CASE WHEN ts >= ?                                  THEN input_tokens         ELSE 0 END) AS today_input,
      SUM(CASE WHEN ts >= ?                                  THEN output_tokens        ELSE 0 END) AS today_output,
      SUM(CASE WHEN ts >= ?                                  THEN cache_read_tokens    ELSE 0 END) AS today_cache_read,
      SUM(CASE WHEN ts >= ?                                  THEN cache_create_tokens  ELSE 0 END) AS today_cache_create,
      SUM(CASE WHEN ts >= ?                                  THEN cost_usd             ELSE 0 END) AS today_cost_usd,
      SUM(CASE WHEN ts >= ?                                  THEN cost_usd             ELSE 0 END) AS month_cost_usd,
      SUM(CASE WHEN ts >= UTC_TIMESTAMP() - INTERVAL 1 HOUR  THEN cost_usd             ELSE 0 END) AS last1h_cost_usd,
      SUM(CASE WHEN ts >= UTC_TIMESTAMP() - INTERVAL 1 HOUR
               THEN input_tokens + output_tokens + cache_read_tokens + cache_create_tokens
               ELSE 0 END) AS last1h_total_tokens,
      MAX(ts) AS last_event_ts
    FROM usage_events
    WHERE ts >= LEAST(?, UTC_TIMESTAMP() - INTERVAL 1 HOUR)
    GROUP BY system_name, host
    `,
    // placeholders: today_input, today_output, today_cache_read, today_cache_create, today_cost_usd, month_cost_usd, WHERE
    [todayUtc, todayUtc, todayUtc, todayUtc, todayUtc, monthUtc, monthUtc],
  )

  const homeRows = rows.filter((r) => String(r.host) === "home")
  const mbpRows = rows.filter((r) => String(r.host) === "mbp")
  const bySystem = new Map<string, mysql.RowDataPacket>()
  for (const r of homeRows) bySystem.set(String(r.system_name), r)

  const systems: SystemSummary[] = ALL_SYSTEMS.map((s) => {
    const r = bySystem.get(s)
    const today_input = toNumber(r?.today_input)
    const today_output = toNumber(r?.today_output)
    const today_cache_read = toNumber(r?.today_cache_read)
    const today_cache_create = toNumber(r?.today_cache_create)
    return {
      system: s,
      today_input,
      today_output,
      today_cache_read,
      today_cache_create,
      today_cost_usd: toNumber(r?.today_cost_usd),
      today_total_tokens:
        today_input + today_output + today_cache_read + today_cache_create,
      month_cost_usd: toNumber(r?.month_cost_usd),
      last1h_cost_usd: toNumber(r?.last1h_cost_usd),
      last1h_total_tokens: toNumber(r?.last1h_total_tokens),
      last_event_ts: r?.last_event_ts
        ? new Date(r.last_event_ts as string | Date).toISOString()
        : null,
    }
  })

  // quant-flow 桶三源合并：
  //   (1) MySQL usage_events：claude-usage watcher 按 cwd=/app 归类的 Claude Code headless 调用
  //   (2) Codex sessions by cwd=/app：codexBucketByCwdPrefix 从 SQLite 读
  //   (3) tracer JSONL：只取按量 provider（deepseek / qwen 等），claude_headless 和
  //       codex_headless 必须排除——它们的权威源分别是 (1) 和 (2)，算进来就是双计。
  const monthEpoch = Math.floor(beijingMonthStartUtc().getTime() / 1000)
  const hourAgoEpoch = Math.floor((Date.now() - 3600_000) / 1000)
  const HEADLESS_PROVIDERS_WITH_OTHER_SOURCE = new Set(["claude_headless", "codex_headless"])
  const quantFlowTracer = summarizeQuantFlowTracer(
    listQuantFlowTracerEntries(Math.min(monthEpoch, hourAgoEpoch)).filter(
      (entry) => !HEADLESS_PROVIDERS_WITH_OTHER_SOURCE.has(entry.provider),
    )
  )
  const quantFlowCodex = codexBucketByCwdPrefix("/app")
  const qf = systems.find((x) => x.system === "quant-flow")
  if (qf) {
    mergeBucketUsage(qf, quantFlowTracer)
    // Codex 无 cache 概念,保持 today_cache_read / today_cache_create 不变
    mergeBucketUsage(qf, quantFlowCodex)
  }

  // MBP（公司机器）本地 Claude Code：host='mbp' 的所有 system_name 聚成一桶单列。
  // 家服系统卡已过滤 host='home'，两者互斥，totals 对 systems 聚合每行恰好计一次。
  systems.push(buildHostSummary(mbpRows, "mbp"))

  const totals = systems.reduce(
    (acc, s) => {
      acc.today_cost_usd += s.today_cost_usd
      acc.today_total_tokens += s.today_total_tokens
      acc.month_cost_usd += s.month_cost_usd
      acc.last1h_total_tokens += s.last1h_total_tokens
      return acc
    },
    { today_cost_usd: 0, today_total_tokens: 0, month_cost_usd: 0, last1h_total_tokens: 0 }
  )

  return { as_of: new Date().toISOString(), systems, totals }
}

export interface BreakdownPoint {
  hour_utc: string
  system: SystemName
  model: string
  total_tokens: number
  cost_usd: number
}

export type Provider = "claude" | "codex"

export interface ModelUsage {
  provider: Provider
  model: string
  output_today: number
  total_today: number
  cost_today: number
  output_weekly: number
  total_weekly: number
  cost_weekly: number
  threads_today: number
  threads_weekly: number
}

export interface ProductGroup {
  provider: Provider
  models: ModelUsage[]
  cost_today: number
  cost_weekly: number
  total_today: number
  total_weekly: number
}

export interface RateLimitData {
  as_of: string
  groups: ProductGroup[]
}

type ClaudeTier = "opus" | "sonnet" | "haiku"

function classifyTier(model: string): ClaudeTier {
  if (model.includes("opus")) return "opus"
  if (model.includes("haiku")) return "haiku"
  return "sonnet"
}

function getOrCreateClaudeTierUsage(byTier: Map<ClaudeTier, ModelUsage>, tier: ClaudeTier): ModelUsage {
  const existing = byTier.get(tier)
  if (existing) return existing

  const usage: ModelUsage = {
    provider: "claude",
    model: tier,
    output_today: 0,
    total_today: 0,
    cost_today: 0,
    output_weekly: 0,
    total_weekly: 0,
    cost_weekly: 0,
    threads_today: 0,
    threads_weekly: 0,
  }
  byTier.set(tier, usage)
  return usage
}

export async function getRateLimitUsage(): Promise<RateLimitData> {
  const p = getPool()
  const todayUtc = beijingTodayUtc().toISOString().slice(0, 19).replace("T", " ")
  const resetUtc = weeklyResetUtc().toISOString().slice(0, 19).replace("T", " ")
  const [rows] = await p.query<mysql.RowDataPacket[]>(
    `
    SELECT
      model,
      SUM(CASE WHEN ts >= ? THEN output_tokens ELSE 0 END) AS out_today,
      SUM(CASE WHEN ts >= ? THEN output_tokens ELSE 0 END) AS out_weekly,
      SUM(CASE WHEN ts >= ?
               THEN input_tokens + output_tokens + cache_read_tokens + cache_create_tokens
               ELSE 0 END) AS total_today,
      SUM(CASE WHEN ts >= ?
               THEN input_tokens + output_tokens + cache_read_tokens + cache_create_tokens
               ELSE 0 END) AS total_weekly,
      SUM(CASE WHEN ts >= ? THEN cost_usd ELSE 0 END) AS cost_today,
      SUM(CASE WHEN ts >= ? THEN cost_usd ELSE 0 END) AS cost_weekly
    FROM usage_events
    WHERE ts >= LEAST(?, ?)
    GROUP BY model
    `,
    [todayUtc, resetUtc, todayUtc, resetUtc, todayUtc, resetUtc, resetUtc, todayUtc],
  )

  // Aggregate Claude models by tier
  const byTier = new Map<ClaudeTier, ModelUsage>()
  for (const r of rows) {
    const tier = classifyTier(String(r.model))
    const usage = getOrCreateClaudeTierUsage(byTier, tier)
    usage.output_today += toNumber(r.out_today)
    usage.output_weekly += toNumber(r.out_weekly)
    usage.total_today += toNumber(r.total_today)
    usage.total_weekly += toNumber(r.total_weekly)
    usage.cost_today += toNumber(r.cost_today)
    usage.cost_weekly += toNumber(r.cost_weekly)
  }

  // Claude Code headless 调用已经由 MySQL usage_events 覆盖（watcher 从
  // ~/.claude/sessions jsonl 按 cwd 归类并按 Anthropic API rate 算 cost_usd），
  // 不要再从 tracer JSONL 追加一次——那会把 quant-flow 容器内每次 claude -p 算两遍。

  const ALL_TIERS: ClaudeTier[] = ["opus", "sonnet", "haiku"]
  const claudeModels: ModelUsage[] = ALL_TIERS.map(
    (t) => byTier.get(t) ?? {
      provider: "claude", model: t,
      output_today: 0, output_weekly: 0, total_today: 0, total_weekly: 0,
      cost_today: 0, cost_weekly: 0, threads_today: 0, threads_weekly: 0,
    }
  )

  // Codex models from SQLite
  const codexModels = getCodexModels()

  const sum = (arr: ModelUsage[], key: keyof ModelUsage) =>
    arr.reduce((s, m) => s + (m[key] as number), 0)

  const groups: ProductGroup[] = [
    {
      provider: "claude",
      models: claudeModels,
      cost_today: sum(claudeModels, "cost_today"),
      cost_weekly: sum(claudeModels, "cost_weekly"),
      total_today: sum(claudeModels, "total_today"),
      total_weekly: sum(claudeModels, "total_weekly"),
    },
  ]

  if (codexModels.length > 0) {
    groups.push({
      provider: "codex",
      models: codexModels,
      cost_today: sum(codexModels, "cost_today"),
      cost_weekly: sum(codexModels, "cost_weekly"),
      total_today: sum(codexModels, "total_today"),
      total_weekly: sum(codexModels, "total_weekly"),
    })
  }

  return { as_of: new Date().toISOString(), groups }
}

// OpenAI pricing per million tokens (from OpenRouter 2026-04)
const OPENAI_PRICING: Record<string, { input: number; cached: number; output: number }> = {
  "gpt-5.4": { input: 2.50, cached: 1.25, output: 15.00 },
  "gpt-5.3": { input: 1.00, cached: 0.50, output: 4.00 },
  "gpt-4.1": { input: 2.00, cached: 0.50, output: 8.00 },
  "o3":      { input: 2.00, cached: 1.00, output: 8.00 },
  "o4-mini": { input: 1.10, cached: 0.275, output: 4.40 },
}
const DEFAULT_PRICING = { input: 2.50, cached: 1.25, output: 10.00 }

interface CodexSessionTokens {
  model: string
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
  total_tokens: number
  created_at: number // unix epoch
  cwd: string
}

function computeCodexCost(model: string, input: number, cached: number, output: number): number {
  const p = OPENAI_PRICING[model] ?? DEFAULT_PRICING
  const uncached = input - cached
  return (uncached * p.input + cached * p.cached + output * p.output) / 1_000_000
}

/**
 * 读取自 min(Claude weekly, Codex weekly, 本月 1 号 00:00) 以来所有 Codex session 的 token 明细。
 * RateLimitCard Codex 桶按 codex weekly 聚合、quant-flow 桶要到月初 — 所以取三者最早,
 * 调用方再按自己窗口过滤。
 * 返回按 session 粒度的数组；调用方可按 cwd / model / ts 自行聚合。
 */
function listCodexSessions(): CodexSessionTokens[] {
  const sessionsDir = process.env.CODEX_SESSIONS_PATH ||
    path.join(process.env.HOME || "/home/jiaxu", ".codex/sessions")
  const dbPath = process.env.CODEX_DB_PATH ||
    path.join(process.env.HOME || "/home/jiaxu", ".codex/state_5.sqlite")

  const weeklyEpoch = Math.floor(weeklyResetUtc().getTime() / 1000)
  const codexWeeklyEpoch = Math.floor(codexWeeklyResetUtc().getTime() / 1000)
  const monthEpoch = Math.floor(beijingMonthStartUtc().getTime() / 1000)
  const sinceEpoch = Math.min(weeklyEpoch, codexWeeklyEpoch, monthEpoch)

  interface ThreadRow { id: string; model: string; created_at: number; tokens_used: number }
  let threads: ThreadRow[] = []
  try {
    const tmpBase = path.join(os.tmpdir(), "codex_state_5.sqlite")
    fs.copyFileSync(dbPath, tmpBase)
    const walSrc = dbPath + "-wal"
    const shmSrc = dbPath + "-shm"
    if (fs.existsSync(walSrc)) fs.copyFileSync(walSrc, tmpBase + "-wal")
    if (fs.existsSync(shmSrc)) fs.copyFileSync(shmSrc, tmpBase + "-shm")
    const db = new Database(tmpBase, { readonly: true })
    threads = db.prepare(
      `SELECT id, COALESCE(model,'unknown') AS model, created_at, tokens_used
       FROM threads WHERE created_at >= ? ORDER BY created_at`
    ).all(sinceEpoch) as ThreadRow[]
    db.close()
    try { fs.unlinkSync(tmpBase + "-wal") } catch {}
    try { fs.unlinkSync(tmpBase + "-shm") } catch {}
  } catch { return [] }

  if (threads.length === 0) return []

  const sessions: CodexSessionTokens[] = []
  for (const t of threads) {
    const detail = parseCodexJsonl(sessionsDir, t)
    if (detail) {
      sessions.push(detail)
    } else {
      // SQLite fallback: 无 cwd / 无 input/output 拆分 — cwd 留空，后续 cwd 过滤会落到"全局"
      // 跳过流产的 session（JSONL 只写了 header 就退出，SQLite 里 model=NULL、tokens_used=0）
      // —— 否则 COALESCE(model,'unknown') 会在首页造一行 tokens 全 0 的 "unknown" 幽灵桶
      if (t.tokens_used === 0) continue
      sessions.push({
        model: t.model,
        input_tokens: t.tokens_used,
        cached_input_tokens: 0,
        output_tokens: 0,
        total_tokens: t.tokens_used,
        created_at: t.created_at,
        cwd: "",
      })
    }
  }
  return sessions
}

/**
 * Aggregate Codex sessions by model for RateLimitCard (全局,不按 cwd 过滤).
 * weekly 窗口用 Codex 自己的重置点(codexWeeklyResetUtc),不跟 Claude 的周日 11:00。
 */
function getCodexModels(): ModelUsage[] {
  const todayEpoch = Math.floor(beijingTodayUtc().getTime() / 1000)
  const codexWeeklyEpoch = Math.floor(codexWeeklyResetUtc().getTime() / 1000)
  const sessions = listCodexSessions()
  if (sessions.length === 0) return []

  const byModel = new Map<string, ModelUsage>()
  for (const s of sessions) {
    const isToday = s.created_at >= todayEpoch
    const isWeekly = s.created_at >= codexWeeklyEpoch
    const cost = computeCodexCost(s.model, s.input_tokens, s.cached_input_tokens, s.output_tokens)
    const existing = byModel.get(s.model)
    if (existing) {
      if (isWeekly) {
        existing.output_weekly += s.output_tokens
        existing.total_weekly += s.total_tokens
        existing.cost_weekly += cost
        existing.threads_weekly += 1
      }
      if (isToday) {
        existing.output_today += s.output_tokens
        existing.total_today += s.total_tokens
        existing.cost_today += cost
        existing.threads_today += 1
      }
    } else {
      byModel.set(s.model, {
        provider: "codex",
        model: s.model,
        output_today: isToday ? s.output_tokens : 0,
        total_today: isToday ? s.total_tokens : 0,
        cost_today: isToday ? cost : 0,
        output_weekly: isWeekly ? s.output_tokens : 0,
        total_weekly: isWeekly ? s.total_tokens : 0,
        cost_weekly: isWeekly ? cost : 0,
        threads_today: isToday ? 1 : 0,
        threads_weekly: isWeekly ? 1 : 0,
      })
    }
  }
  // 如果某个 model 今日有活动但 weekly 窗口外,仍需保留；若完全没有(既非 today 也非 weekly),仍进 map —
  // 因为 Map 已经按 byModel.set 保证至少该 session 存在过。这里不再清理空记录,保持 key 稳定。
  return Array.from(byModel.values())
}

/**
 * Codex session 中 cwd 匹配 cwdPrefix 的子集,聚合成 TokenCard 桶需要的字段。
 * 用于 quant-flow 桶（cwdPrefix="/app"）把容器内 Codex 调用汇总进 jiaxu-portal 首页卡片。
 * 注意：last1h 用 session.created_at 粗略近似（缺 per-message 时间粒度）。
 */
function codexBucketByCwdPrefix(cwdPrefix: string): BucketUsageSummary {
  const nowMs = Date.now()
  const todayEpoch = Math.floor(beijingTodayUtc().getTime() / 1000)
  const monthEpoch = Math.floor(beijingMonthStartUtc().getTime() / 1000)
  const hourAgoEpoch = Math.floor((nowMs - 3600_000) / 1000)

  // segment-aware: "/app" 不应匹配 /app2 或 /application,和 watcher.py 规则保持一致
  const sessions = listCodexSessions().filter(
    (s) => s.cwd === cwdPrefix || s.cwd.startsWith(cwdPrefix + "/"),
  )
  if (sessions.length === 0) return emptyBucketUsageSummary()

  const acc = emptyBucketUsageSummary()
  let maxTs = 0
  for (const s of sessions) {
    const cost = computeCodexCost(s.model, s.input_tokens, s.cached_input_tokens, s.output_tokens)
    if (s.created_at >= monthEpoch) {
      acc.month_cost_usd += cost
    }
    if (s.created_at >= todayEpoch) {
      acc.today_input += s.input_tokens
      acc.today_output += s.output_tokens
      acc.today_cost_usd += cost
      acc.today_total_tokens += s.total_tokens
    }
    if (s.created_at >= hourAgoEpoch) {
      acc.last1h_cost_usd += cost
      acc.last1h_total_tokens += s.total_tokens
    }
    if (s.created_at > maxTs) maxTs = s.created_at
  }
  acc.last_event_ts = maxTs > 0 ? new Date(maxTs * 1000).toISOString() : null
  return acc
}

/** Parse the last token_count event + session_meta cwd from a Codex JSONL session file */
function parseCodexJsonl(sessionsDir: string, thread: { id: string; created_at: number }): CodexSessionTokens | null {
  try {
    // JSONL path: sessions/YYYY/MM/DD/rollout-*-{thread_id}.jsonl
    const bjDate = new Date(thread.created_at * 1000 + 8 * 3600_000)
    const y = String(bjDate.getUTCFullYear())
    const m = String(bjDate.getUTCMonth() + 1).padStart(2, "0")
    const d = String(bjDate.getUTCDate()).padStart(2, "0")
    const dayDir = path.join(sessionsDir, y, m, d)

    if (!fs.existsSync(dayDir)) return null

    const files = fs.readdirSync(dayDir).filter((f) => f.includes(thread.id) && f.endsWith(".jsonl"))
    if (files.length === 0) return null

    const content = fs.readFileSync(path.join(dayDir, files[0]), "utf-8")
    const lines = content.split("\n").filter(Boolean)

    let model = "unknown"
    let cwd = ""
    let lastUsage: { input_tokens: number; cached_input_tokens: number; output_tokens: number; total_tokens: number } | null = null

    for (const line of lines) {
      try {
        const evt = JSON.parse(line)
        // Session-level cwd from the session_meta event (first line)
        if (evt.type === "session_meta" && evt.payload?.cwd) {
          cwd = String(evt.payload.cwd)
        }
        // Get model from turn_context
        if (evt.type === "turn_context" && evt.payload?.model) {
          model = evt.payload.model
        }
        // Get token usage from last token_count with info
        if (evt.type === "event_msg" && evt.payload?.type === "token_count" && evt.payload?.info?.total_token_usage) {
          const u = evt.payload.info.total_token_usage
          lastUsage = {
            input_tokens: u.input_tokens ?? 0,
            cached_input_tokens: u.cached_input_tokens ?? 0,
            output_tokens: (u.output_tokens ?? 0) + (u.reasoning_output_tokens ?? 0),
            total_tokens: u.total_tokens ?? 0,
          }
        }
      } catch { /* skip malformed lines */ }
    }

    if (!lastUsage) return null
    return { model, ...lastUsage, created_at: thread.created_at, cwd }
  } catch {
    return null
  }
}

export async function getUsageBreakdown(hours = 24): Promise<BreakdownPoint[]> {
  const p = getPool()
  const [rows] = await p.query<mysql.RowDataPacket[]>(
    `
    SELECT
      DATE_FORMAT(DATE_ADD(ts, INTERVAL -MINUTE(ts) MINUTE), '%Y-%m-%dT%H:00:00Z') AS hour_utc,
      system_name AS system,
      model,
      SUM(input_tokens + output_tokens + cache_read_tokens + cache_create_tokens) AS total_tokens,
      SUM(cost_usd) AS cost_usd
    FROM usage_events
    WHERE ts >= UTC_TIMESTAMP() - INTERVAL ? HOUR
    GROUP BY hour_utc, system, model
    ORDER BY hour_utc ASC
    `,
    [hours]
  )
  return rows.map((r) => ({
    hour_utc: String(r.hour_utc),
    system: r.system as SystemName,
    model: String(r.model),
    total_tokens: Number(r.total_tokens || 0),
    cost_usd: Number(r.cost_usd || 0),
  }))
}
