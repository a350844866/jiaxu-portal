/**
 * claude-quota-pure — 解析宿主采样器写的 Claude Max **官方配额**帧(纯函数, 无 fs, 客户端可用).
 *
 * 数据链路:
 *   宿主 systemd timer claude-quota-sample(5min) → GET api.anthropic.com/api/oauth/usage
 *     (与 Claude Code `/usage` 同源, 用 ~/.claude/.credentials.json 的 OAuth token)
 *     + 同窗口内按 watcher PRICING 折算的 $(按模型) → 原子写 /data/portal-state/claude-quota.json
 *
 * 为什么要它(2026-09-03): 本卡其它所有 $ 都是 **API 标价折算**, 不是 Max 订阅真正扣的配额.
 * Fable 5.1 cache read 只有 $0.25(Fable 5 的 1/4), 标价看着"没用多少", 订阅配额却照扣 ——
 * 只有官方 utilization 才是真数. 而且官方 `limits[]` 里除 5h 窗 / 全模型周池外还有一条
 * **weekly_scoped(按模型家族单独限额, 实测 scope=Fable, 48% vs 周池 33%)**, 那才是 Fable
 * "烧得快"的那根线 —— five_hour/seven_day 两个字段看不到它, 所以本模块以 limits[] 为准.
 */

export type QuotaWindow = {
  /** 0-100, 官方只给整数 */
  utilization: number | null
  /** ISO, 官方给; 客户端据此算倒计时 */
  resets_at: string | null
  /** resets_at − 5h/7d, 采样器算好 */
  window_start: string | null
  /** 同窗口内按 watcher PRICING 折算的 $(全模型合计); 采样器没查到 DB / 没一条能解析时为 null */
  usd_since_start: number | null
  usd_by_model: Record<string, number>
}

export type QuotaLimit = {
  /** session | weekly_all | weekly_scoped | (未来新种类原样透传) */
  kind: string
  /** session | weekly */
  group: string | null
  /** 0-100 */
  percent: number | null
  severity: string | null
  resets_at: string | null
  is_active: boolean
  /** weekly_scoped 的作用域: 模型家族显示名(实测 "Fable"); 其它种类为 null */
  scope_model: string | null
}

export type ClaudeQuota =
  | {
      ok: true
      sampled_at: string
      age_seconds: number
      stale: boolean
      five_hour: QuotaWindow
      seven_day: QuotaWindow
      /** 官方完整配额清单; 帧里没有时由 five_hour/seven_day 合成两条, UI 只走这一条路 */
      limits: QuotaLimit[]
      /** 采样器查 MySQL 失败时的原因(此时 usd_* 为 null) */
      db_error: string | null
    }
  | { ok: false; error: string; sampled_at: string | null; age_seconds: number | null; stale: true }

/** timer 5min 一跳; 连丢 3 跳(15min)才算陈旧, 与 claude-topics / cron-snapshot 阈值一致 */
export const QUOTA_STALE_MS = 15 * 60 * 1000
/** 帧 ts 允许领先本机时钟的上限; 再往前就是坏帧/时钟偏差, 否则 age 被夹成 0 会永远"新鲜" */
export const QUOTA_FUTURE_SKEW_MS = 5 * 60 * 1000

type RawWindow = { utilization?: unknown; resets_at?: unknown; window_start?: unknown }
type RawUsd = Record<string, { usd?: unknown } | null | undefined> | null | undefined
type RawLimit = {
  kind?: unknown
  group?: unknown
  percent?: unknown
  severity?: unknown
  resets_at?: unknown
  is_active?: unknown
  scope?: { model?: { display_name?: unknown } | null } | null
}
type RawFrame = {
  ts?: unknown
  ok?: unknown
  error?: unknown
  db_error?: unknown
  five_hour?: RawWindow | null
  seven_day?: RawWindow | null
  limits?: unknown
  usd_five_hour_by_model?: RawUsd
  usd_seven_day_by_model?: RawUsd
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

function pct(v: unknown): number | null {
  const n = num(v)
  return n === null ? null : Math.max(0, Math.min(100, n))
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null
}

/** 官方 resets_at 带 6 位微秒("…00.019911+00:00"), ECMAScript 只保证 3 位 —— 先截到毫秒再 parse */
export function parseIsoMs(s: string | null | undefined): number | null {
  if (!s) return null
  const t = Date.parse(s.replace(/(\.\d{3})\d+/, "$1"))
  return Number.isFinite(t) ? t : null
}

function toWindow(w: RawWindow | null | undefined, usd: RawUsd): QuotaWindow {
  const byModel: Record<string, number> = {}
  let entries = 0
  for (const [m, v] of Object.entries(usd ?? {})) {
    entries++
    const n = num(v?.usd)
    if (n !== null) byModel[m] = n
  }
  const parsed = Object.keys(byModel).length
  return {
    utilization: pct(w?.utilization),
    resets_at: str(w?.resets_at),
    window_start: str(w?.window_start),
    // null = 没查到 DB(采样器给 null) 或有条目但一条都解析不了; {} = 窗口内没花钱, 如实给 0
    usd_since_start: !usd || (entries > 0 && parsed === 0) ? null : Object.values(byModel).reduce((s, x) => s + x, 0),
    usd_by_model: byModel,
  }
}

function toLimits(raw: unknown, fiveHour: QuotaWindow, sevenDay: QuotaWindow): QuotaLimit[] {
  const out: QuotaLimit[] = []
  if (Array.isArray(raw)) {
    for (const l of raw as RawLimit[]) {
      const kind = str(l?.kind)
      if (!kind) continue
      out.push({
        kind,
        group: str(l?.group),
        percent: pct(l?.percent),
        severity: str(l?.severity),
        resets_at: str(l?.resets_at),
        is_active: l?.is_active === true,
        scope_model: str(l?.scope?.model?.display_name),
      })
    }
  }
  if (out.length > 0) return out
  // 老帧 / 官方没给 limits: 用两个窗口合成, 让 UI 只维护一条渲染路径
  return [
    { kind: "session", group: "session", percent: fiveHour.utilization, severity: null, resets_at: fiveHour.resets_at, is_active: false, scope_model: null },
    { kind: "weekly_all", group: "weekly", percent: sevenDay.utilization, severity: null, resets_at: sevenDay.resets_at, is_active: false, scope_model: null },
  ]
}

export function parseQuotaFrame(raw: string, nowMs: number): ClaudeQuota {
  let frame: RawFrame
  try {
    frame = JSON.parse(raw) as RawFrame
  } catch {
    return { ok: false, error: "配额帧不是合法 JSON", sampled_at: null, age_seconds: null, stale: true }
  }
  const sampledAt = str(frame?.ts)
  const sampledMs = parseIsoMs(sampledAt)
  if (sampledMs !== null && sampledMs - nowMs > QUOTA_FUTURE_SKEW_MS) {
    return { ok: false, error: "配额帧时间在未来(宿主时钟偏差?)", sampled_at: sampledAt, age_seconds: null, stale: true }
  }
  const age = sampledMs === null ? null : Math.max(0, Math.round((nowMs - sampledMs) / 1000))
  if (frame?.ok !== true) {
    // 采样器自己失败(典型: OAuth token 过期 —— Claude Code 长时间没跑就不会刷新), 帧里没数.
    // 如实报错, 不拿上一帧充数.
    return {
      ok: false,
      error: `采样失败: ${str(frame?.error) ?? "未知原因"}`,
      sampled_at: sampledAt,
      age_seconds: age,
      stale: true,
    }
  }
  if (sampledAt === null || age === null) {
    return { ok: false, error: "配额帧缺 ts", sampled_at: null, age_seconds: null, stale: true }
  }
  const fiveHour = toWindow(frame.five_hour, frame.usd_five_hour_by_model)
  const sevenDay = toWindow(frame.seven_day, frame.usd_seven_day_by_model)
  if (fiveHour.utilization === null || sevenDay.utilization === null) {
    // ok:true 但没数 = 采样器写坏了, 不能当"成功且空"渲染一排 "—"
    return { ok: false, error: "配额帧缺 five_hour/seven_day utilization", sampled_at: sampledAt, age_seconds: age, stale: true }
  }
  return {
    ok: true,
    sampled_at: sampledAt,
    age_seconds: age,
    stale: age * 1000 > QUOTA_STALE_MS,
    five_hour: fiveHour,
    seven_day: sevenDay,
    limits: toLimits(frame.limits, fiveHour, sevenDay),
    db_error: str(frame?.db_error),
  }
}

/** 展示顺序: 5h 窗 → 专属周限(通常是绑定的那条) → 全模型周池 → 其它 */
export function sortLimits(limits: QuotaLimit[]): QuotaLimit[] {
  const rank = (l: QuotaLimit) => (l.kind === "session" ? 0 : l.kind === "weekly_scoped" ? 1 : l.kind === "weekly_all" ? 2 : 3)
  return [...limits].sort((a, b) => rank(a) - rank(b) || (b.percent ?? -1) - (a.percent ?? -1))
}

export function limitLabel(l: QuotaLimit): string {
  if (l.kind === "session") return "5 小时窗"
  if (l.kind === "weekly_all") return "本周 · 全模型"
  if (l.kind === "weekly_scoped") return `本周 · ${l.scope_model ?? "专属"}`
  return l.kind
}

/**
 * 这条限额对应窗口内的标价折算 $: session → 5h 窗全模型; weekly_all → 7d 窗全模型;
 * weekly_scoped → 7d 窗内只算作用域家族的模型(model id 含 scope 名, 大小写不敏感).
 * 返回 null = 采样器没查到 DB / 无法对应.
 */
export function limitUsd(l: QuotaLimit, q: Extract<ClaudeQuota, { ok: true }>): { usd: number | null; by_model: Record<string, number> } {
  const w = l.group === "session" || l.kind === "session" ? q.five_hour : q.seven_day
  if (w.usd_since_start === null) return { usd: null, by_model: {} }
  if (l.kind !== "weekly_scoped") return { usd: w.usd_since_start, by_model: w.usd_by_model }
  if (!l.scope_model) return { usd: null, by_model: {} }
  const needle = l.scope_model.toLowerCase()
  const by_model: Record<string, number> = {}
  for (const [m, v] of Object.entries(w.usd_by_model)) if (m.toLowerCase().includes(needle)) by_model[m] = v
  return { usd: Object.values(by_model).reduce((s, x) => s + x, 0), by_model }
}

/** 帧最多 5 分钟旧: resets_at 已过而下一帧未到时, 帧里的 % 说的是上一个窗口, 不能当现窗口显示 */
export function isRolledOver(resetsAt: string | null, nowMs: number): boolean {
  const t = parseIsoMs(resetsAt)
  return t !== null && t <= nowMs
}

/** 客户端自算采样年龄: 服务端算的 age 冻在最后一次成功拉取那一刻, 轮询断了它就不动了 */
export function ageWithDrift(ageSeconds: number, fetchedAtMs: number, nowMs: number): number {
  return Math.max(0, ageSeconds + Math.round((nowMs - fetchedAtMs) / 1000))
}

/**
 * 官方 7d 窗起点(优先 weekly_all 的 resets_at − 7d, 其次采样器算好的 window_start).
 * 只接受 (now − 8d, now] 内的值, 防坏帧把"本周 $"拉到离谱区间.
 */
export function officialWeeklyStartMs(q: ClaudeQuota, nowMs: number): number | null {
  if (!q.ok) return null
  const weekly = q.limits.find((l) => l.kind === "weekly_all")
  const fromLimit = parseIsoMs(weekly?.resets_at)
  const start = fromLimit !== null ? fromLimit - 7 * 24 * 3600 * 1000 : parseIsoMs(q.seven_day.window_start)
  if (start === null) return null
  if (start > nowMs || start < nowMs - 8 * 24 * 3600 * 1000) return null
  return start
}

/** 到重置还有多久: "2d 17h" / "1h 22m" / "38m" / "<1m" / "已重置" / "—" */
export function fmtCountdown(resetsAt: string | null, nowMs: number): string {
  const t = parseIsoMs(resetsAt)
  if (t === null) return "—"
  const s = Math.round((t - nowMs) / 1000)
  if (s <= 0) return "已重置"
  if (s < 60) return "<1m"
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/** 重置时刻的北京墙钟: "11:30" / "周日 11:00"(用户口径 UTC+8, 存储保持 UTC) */
export function fmtResetClock(resetsAt: string | null, withWeekday = false): string {
  const t = parseIsoMs(resetsAt)
  if (t === null) return ""
  const d = new Date(t)
  const time = d.toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false })
  if (!withWeekday) return time
  const wd = d.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", weekday: "short" })
  return `${wd} ${time}`
}
