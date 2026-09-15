/**
 * glm-usage-pure — 解析宿主写的 cpclaude(部门 GLM 网关)用量快照(纯函数, 无 fs).
 *
 * 数据链路(脚本在 scripts/glm-usage/):
 *   来源机本地抽数字(glm_usage_extract.py, 会话文本不出机)
 *     MBP:         launchd 10min → rsync(ssh home-server 隧道) → /data/claude-usage/remote-glm/mbp.json
 *     家服云脉 VM: 宿主 timer 经 ssh 在 VM 内抽取 → remote-glm/yunmai-vm.json
 *   → 宿主 glm-usage-snapshot.timer(5min) glm_usage_aggregate.py: 按 message.id 跨机去重、北京时间分窗
 *   → 原子写 /data/portal-state/glm-usage.json   (本模块只解析这一步产物)
 *
 * 快照里只有 token 数与模型/机器/项目目录名 —— 没有会话文本, 也没有金额(网关无价目出处)与额度数字
 * (2026-09-15 探测网关无额度/余额接口).
 */

export const GLM_SNAPSHOT_SCHEMA = 1
/** timer 5min 一跳; 连丢 3 跳(15min)才算陈旧, 与 claude-quota / claude-topics 一致 */
export const GLM_STALE_MS = 15 * 60 * 1000
/** 快照 ts 允许领先本机时钟的上限; 再往前就是坏帧/时钟偏差 */
export const GLM_FUTURE_SKEW_MS = 5 * 60 * 1000
export const GLM_READ_TIMEOUT_MS = 2000
/** 正常快照 ~10KB(项目桶宿主侧已截 top 20) */
export const GLM_MAX_BYTES = 256 * 1024

export type GlmBucket = {
  input: number
  cache_read: number
  cache_creation: number
  output: number
  total: number
  msgs: number
}

export type GlmWindow = {
  totals: GlmBucket
  by_model: Record<string, GlmBucket>
  by_host: Record<string, GlmBucket>
  by_project: Record<string, GlmBucket>
  projects_omitted: number
}

export type GlmHost = {
  host: string
  label: string
  ok: boolean
  error: string | null
  source_generated_at: string | null
  age_seconds: number | null
  stale: boolean
  unique_msgs: number | null
  counted_msgs: number
}

export type GlmQuota = { status: string; probed_at: string | null; detail: string | null }

export type GlmSnapshot = {
  generated_at: string
  month: string
  today: string
  hosts: GlmHost[]
  /** raw/frame_unique = 本轮来源帧; counted = 家服账本累积后跨机去重计入的条数(来源机清理老 jsonl 后可大于帧内条数) */
  dedup: { raw_usage_lines: number; frame_unique_msgs: number; counted_msgs: number; cross_host_dups: number; undated_msgs: number }
  windows: { month: GlmWindow; today: GlmWindow }
  /** null = 快照没带额度段(旧/坏快照), 与"网关无接口"是两回事 */
  quota: GlmQuota | null
}

export type GlmUsageResult =
  | { ok: true; data: GlmSnapshot; ageSeconds: number; stale: boolean; dayRolled: boolean; monthRolled: boolean }
  | { ok: false; kind: "missing" | "invalid" | "io"; error: string; ageSeconds: number | null; stale: true }

type Raw = Record<string, unknown>

function obj(v: unknown): Raw | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : null
}

function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null
}

function parseIsoMs(s: string | null): number | null {
  if (!s) return null
  const t = Date.parse(s.replace(/(\.\d{3})\d+/, "$1"))
  return Number.isFinite(t) ? t : null
}

function toBucket(v: unknown): GlmBucket {
  const b = obj(v) ?? {}
  return {
    input: count(b.input),
    cache_read: count(b.cache_read),
    cache_creation: count(b.cache_creation),
    output: count(b.output),
    total: count(b.total),
    msgs: count(b.msgs),
  }
}

function toBuckets(v: unknown): Record<string, GlmBucket> {
  const out: Record<string, GlmBucket> = {}
  for (const [k, b] of Object.entries(obj(v) ?? {})) out[k] = toBucket(b)
  return out
}

function toWindow(v: unknown): GlmWindow | null {
  const w = obj(v)
  if (!w || !obj(w.totals)) return null
  return {
    totals: toBucket(w.totals),
    by_model: toBuckets(w.by_model),
    by_host: toBuckets(w.by_host),
    by_project: toBuckets(w.by_project),
    projects_omitted: count(w.projects_omitted),
  }
}

function toHost(v: unknown): GlmHost | null {
  const h = obj(v)
  const host = str(h?.host)
  if (!h || !host) return null
  return {
    host,
    label: str(h.label) ?? host,
    ok: h.ok === true,
    error: str(h.error),
    source_generated_at: str(h.source_generated_at),
    age_seconds: typeof h.age_seconds === "number" && Number.isFinite(h.age_seconds) ? Math.max(0, h.age_seconds) : null,
    stale: h.stale !== false,
    unique_msgs: typeof h.unique_msgs === "number" ? h.unique_msgs : null,
    counted_msgs: count(h.counted_msgs),
  }
}

/** 北京日期 YYYY-MM-DD(用户口径 UTC+8) */
export function beijingDate(ms: number): string {
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

export function parseGlmSnapshot(raw: string, nowMs: number): GlmUsageResult {
  let frame: Raw | null
  try {
    frame = obj(JSON.parse(raw))
  } catch {
    return { ok: false, kind: "invalid", error: "快照不是合法 JSON", ageSeconds: null, stale: true }
  }
  if (!frame) return { ok: false, kind: "invalid", error: "快照不是 JSON 对象", ageSeconds: null, stale: true }
  if (frame.schema !== GLM_SNAPSHOT_SCHEMA || frame.kind !== "glm-usage") {
    return {
      ok: false,
      kind: "invalid",
      // 固定措辞, 不回显快照里的值(防超长/不可信内容进 DOM)
      error: `快照 schema 不符(期望 glm-usage v${GLM_SNAPSHOT_SCHEMA})`,
      ageSeconds: null,
      stale: true,
    }
  }
  const generatedAt = str(frame.generated_at)
  const genMs = parseIsoMs(generatedAt)
  if (generatedAt === null || genMs === null) {
    return { ok: false, kind: "invalid", error: "快照缺 generated_at", ageSeconds: null, stale: true }
  }
  if (genMs - nowMs > GLM_FUTURE_SKEW_MS) {
    return { ok: false, kind: "invalid", error: "快照时间在未来(宿主时钟偏差?)", ageSeconds: null, stale: true }
  }
  const windows = obj(frame.windows)
  const month = toWindow(windows?.month)
  const today = toWindow(windows?.today)
  const monthKey = str(frame.month)
  const todayKey = str(frame.today)
  if (!month || !today || !monthKey || !todayKey) {
    return { ok: false, kind: "invalid", error: "快照缺 month/today 窗口", ageSeconds: null, stale: true }
  }
  const ageSeconds = Math.max(0, Math.round((nowMs - genMs) / 1000))
  const dedup = obj(frame.dedup) ?? {}
  const quota = obj(frame.quota)
  const data: GlmSnapshot = {
    generated_at: generatedAt,
    month: monthKey,
    today: todayKey,
    hosts: (Array.isArray(frame.hosts) ? frame.hosts : []).map(toHost).filter((h): h is GlmHost => h !== null),
    dedup: {
      raw_usage_lines: count(dedup.raw_usage_lines),
      frame_unique_msgs: count(dedup.frame_unique_msgs),
      counted_msgs: count(dedup.counted_msgs),
      cross_host_dups: count(dedup.cross_host_dups),
      undated_msgs: count(dedup.undated_msgs),
    },
    windows: { month, today },
    quota: quota && str(quota.status) ? { status: str(quota.status)!, probed_at: str(quota.probed_at), detail: str(quota.detail) } : null,
  }
  return {
    ok: true,
    data,
    ageSeconds,
    stale: ageSeconds * 1000 > GLM_STALE_MS,
    // 快照新鲜但跨了北京午夜: "今日"还是昨天的, 卡片要标出来而不是当今天显示
    dayRolled: beijingDate(nowMs) !== todayKey,
    monthRolled: beijingDate(nowMs).slice(0, 7) !== monthKey,
  }
}

/** fs 读失败 → 文案. 只透出错误码, 不把宿主路径/原始 message 带进 DOM */
export function readErrorResult(code: string): Extract<GlmUsageResult, { ok: false }> {
  if (code === "ENOENT") {
    return { ok: false, kind: "missing", error: "快照尚未生成(宿主 glm-usage-snapshot.timer 未跑过?)", ageSeconds: null, stale: true }
  }
  if (code === "ABORT_ERR" || code === "AbortError" || code === "TimeoutError") {
    return { ok: false, kind: "io", error: `读快照超时(>${GLM_READ_TIMEOUT_MS}ms)`, ageSeconds: null, stale: true }
  }
  if (code === "TOO_LARGE") {
    return { ok: false, kind: "io", error: `快照过大(> ${GLM_MAX_BYTES}B), 查宿主 aggregate`, ageSeconds: null, stale: true }
  }
  return { ok: false, kind: "io", error: `读快照失败(${code})`, ageSeconds: null, stale: true }
}

/** 额度状态一行文案. 拿不到就如实说, 绝不拿价目表或估算冒充额度 */
export function quotaText(q: GlmQuota | null): string {
  if (!q) return "额度：状态未知（快照缺额度段）"
  if (q.status === "unavailable") return "额度：网关未提供接口"
  return `额度：状态未知（${q.status}）`
}

export function fmtTokens(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B"
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M"
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K"
  return String(n)
}

export function ageLabel(sec: number | null): string {
  if (sec === null) return "无数据"
  if (sec < 90) return "刚刚"
  const m = Math.round(sec / 60)
  if (m < 60) return `${m} 分钟前`
  const h = sec / 3600
  return h < 48 ? `${h.toFixed(1)} 小时前` : `${Math.floor(h / 24)} 天前`
}

/** 按 token 合计降序(并列按名字), 桶名只有模型/机器/项目目录名 */
export function sortBuckets(m: Record<string, GlmBucket>): [string, GlmBucket][] {
  return Object.entries(m).sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))
}

export function bucketTitle(b: GlmBucket): string {
  return `input ${fmtTokens(b.input)} · cache_read ${fmtTokens(b.cache_read)} · cache_creation ${fmtTokens(b.cache_creation)} · output ${fmtTokens(b.output)} · ${b.msgs} 条回复`
}

/** 单台来源机的同步状态: 帧坏 / 家服侧异常 → 原因; 超 30min 未同步(MBP 下班断网常见) → 提示, 数据仍计入 */
export function hostSyncLabel(h: GlmHost): { text: string; warn: boolean } {
  if (!h.ok) return { text: h.error ?? "帧不可用", warn: true }
  // 帧正常但家服侧有异常(如账本损坏已重建): 同样要露出来, 否则数字悄悄缩水没人知道
  if (h.error) return { text: h.error, warn: true }
  if (h.stale) return { text: `未同步 ${ageLabel(h.age_seconds)}`, warn: true }
  return { text: `同步于 ${ageLabel(h.age_seconds)}`, warn: false }
}
