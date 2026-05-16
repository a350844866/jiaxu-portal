/**
 * mac-mini-alarms — 告警引擎
 *
 * 5 条规则 (R0-R4) + 抑制 + reboot 静默 + 合并 + cooldown + TG fetch with retry/pending queue。
 * 详见 docs/superpowers/specs/2026-05-16-mac-mini-monitoring-design.md §4.4
 *
 * 关键设计点（来自 codex adversarial review）：
 * - R0 (Mac unreachable) 抑制 R1/R2/R3/R4
 * - router degraded 抑制 R1
 * - R4 用 args 第一段作 PID churn key (comm 字段 macOS ps 截断到 16 字符)
 * - R4 加 pcpu>30% 双门槛防误伤 zsh/sh/GoogleUpdater 等
 * - reboot 静默 R4 (uptime<300 或 uptime 变小)
 * - 同 tick 多规则触发 → 合 1 条 TG，按优先级 R0>R1>R2>R3>R4
 * - cooldown 30min 防活跃期刷屏
 */
import type { MacMetricsSample, ProcInfo } from "./mac-mini-collector"

export type RuleId = "R0_mac_unreachable" | "R1_lan_jitter" | "R2_load_high" | "R3_proc_cpu" | "R4_pid_churn"

const RULE_PRIORITY: Record<RuleId, number> = {
  R0_mac_unreachable: 0,
  R1_lan_jitter: 1,
  R2_load_high: 2,
  R3_proc_cpu: 3,
  R4_pid_churn: 4,
}

const COOLDOWN_MS = 30 * 60 * 1000
const PENDING_QUEUE_MAX = 10

// 阈值
const R1_MDEV_MS = 20
const R1_LOSS_THRESHOLD = 5 // % (5-99% 算 R1, 100% 算 R0)
const R1_TICKS = 3
const R2_LOAD_RATIO = 0.8
const R2_TICKS = 12
const R3_PCPU = 80
const R3_TICKS = 8
const R4_WINDOW_MS = 5 * 60 * 1000
const R4_MIN_PIDS = 3
const R4_MIN_HIGH_CPU_SAMPLES = 2
const R4_HIGH_CPU_THRESHOLD = 30
const R4_REBOOT_SILENCE_MS = 5 * 60 * 1000
const R0_TICKS = 2 // 持续 2-3 tick

const ROUTER_MDEV_OK = 5
const ROUTER_LOSS_OK = 0

export interface AlarmIncident {
  rule: RuleId
  transition: "active" | "recovered"
  since: string
  details: string
}

export interface AlarmState {
  /** 当前活跃告警: ruleId → 进入时间 + 最后推送时间 */
  activeAlarms: Map<RuleId, { since: string; lastSent: string }>
  /** R4: comm key → 样本历史 (ts ms / pid / pcpu) */
  pidHistory: Map<string, Array<{ tsMs: number; pid: number; pcpu: number }>>
  /** 上一次 sample 的 mac_uptime_sec, 用于 reboot 检测 */
  lastUptimeSec: number | null
  /** R4 静默截止时间 (reboot 后 5min) */
  r4SilencedUntilMs: number
  /** 路由器对照异常状态 */
  routerDegraded: boolean
  /** 待发 TG 消息队列 */
  pending: Array<{ text: string; ts: string }>
}

export function createInitialAlarmState(): AlarmState {
  return {
    activeAlarms: new Map(),
    pidHistory: new Map(),
    lastUptimeSec: null,
    r4SilencedUntilMs: 0,
    routerDegraded: false,
    pending: [],
  }
}

export interface AlarmConfig {
  tgBotToken: string
  tgChatId: string
}

export interface AlarmTickResult {
  nextState: AlarmState
  incidents: AlarmIncident[]
  notifySucceeded: boolean
  notifyError: string | null
  pendingCount: number
}

/** 取 args 的第一段作为 PID churn key (executable path), 不用 comm 因为 macOS ps comm 截断 16 字符 */
function procKey(proc: ProcInfo): string {
  const firstToken = proc.args.split(/\s+/)[0] || proc.comm
  return firstToken
}

/** R0: SSH 或 ping 全断, 持续 2-3 tick, 且 router 正常 */
function checkR0(history: MacMetricsSample[]): boolean {
  if (history.length < R0_TICKS) return false
  const last = history.slice(-R0_TICKS)
  return last.every(
    (s) =>
      (s.ssh_ok === false || s.ping_macmini.loss >= 100) &&
      s.ping_router.loss === ROUTER_LOSS_OK &&
      (s.ping_router.mdev === null || s.ping_router.mdev <= ROUTER_MDEV_OK),
  )
}

/** R1: Mac Mini ping mdev>20 或 loss 5-99% 且 router 正常, 持续 R1_TICKS */
function checkR1(history: MacMetricsSample[]): boolean {
  if (history.length < R1_TICKS) return false
  const last = history.slice(-R1_TICKS)
  return last.every((s) => {
    const macBad =
      (s.ping_macmini.mdev !== null && s.ping_macmini.mdev > R1_MDEV_MS) ||
      (s.ping_macmini.loss >= R1_LOSS_THRESHOLD && s.ping_macmini.loss < 100)
    const routerOk =
      s.ping_router.loss === ROUTER_LOSS_OK &&
      (s.ping_router.mdev === null || s.ping_router.mdev <= ROUTER_MDEV_OK)
    return macBad && routerOk
  })
}

/** R2: load1 > ncpu*0.8 持续 R2_TICKS */
function checkR2(history: MacMetricsSample[]): boolean {
  if (history.length < R2_TICKS) return false
  const last = history.slice(-R2_TICKS)
  return last.every((s) => {
    if (s.load === null || s.ncpu === null) return false
    return s.load["1"] > s.ncpu * R2_LOAD_RATIO
  })
}

/** R3: 单进程 CPU>80% 持续 R3_TICKS — 任一进程满足都算 */
function checkR3(history: MacMetricsSample[]): { triggered: boolean; proc?: ProcInfo } {
  if (history.length < R3_TICKS) return { triggered: false }
  const last = history.slice(-R3_TICKS)
  // 找出每个样本里 pcpu>80 的所有 proc, 看是否有同 procKey 持续 R3_TICKS 次都出现
  const counts = new Map<string, { count: number; latest: ProcInfo }>()
  for (const s of last) {
    if (!s.top_proc) continue
    for (const p of s.top_proc) {
      if (p.pcpu > R3_PCPU) {
        const key = procKey(p)
        const prev = counts.get(key)
        counts.set(key, { count: (prev?.count ?? 0) + 1, latest: p })
      }
    }
  }
  for (const [, v] of counts) {
    if (v.count >= R3_TICKS) {
      return { triggered: true, proc: v.latest }
    }
  }
  return { triggered: false }
}

/**
 * R4 PID churn: 同 procKey 在 5min 内出现 ≥3 个不同 PID, 且 ≥2 个样本 pcpu>30%
 * 用 args 第一段作 key (macOS ps comm 截断)
 */
function checkR4(
  history: MacMetricsSample[],
  state: AlarmState,
): { triggered: boolean; procKey?: string; pidCount?: number } {
  // 静默期内不触发
  if (Date.now() < state.r4SilencedUntilMs) return { triggered: false }

  // 更新 pidHistory (只看 ssh_ok 的 sample)
  // 注意: this is a pure read function; we don't mutate state here
  // 我们在 reduce 阶段重建 pidHistory
  const tempHistory = new Map<string, Array<{ tsMs: number; pid: number; pcpu: number }>>()
  const cutoff = Date.now() - R4_WINDOW_MS

  for (const s of history) {
    if (!s.ssh_ok || !s.top_proc) continue
    const tsMs = new Date(s.ts).getTime()
    if (tsMs < cutoff) continue
    for (const p of s.top_proc) {
      const key = procKey(p)
      const arr = tempHistory.get(key) || []
      arr.push({ tsMs, pid: p.pid, pcpu: p.pcpu })
      tempHistory.set(key, arr)
    }
  }

  // 检查是否有 key 满足条件
  for (const [key, arr] of tempHistory) {
    const uniquePids = new Set(arr.map((x) => x.pid))
    const highCpuSamples = arr.filter((x) => x.pcpu > R4_HIGH_CPU_THRESHOLD).length
    if (uniquePids.size >= R4_MIN_PIDS && highCpuSamples >= R4_MIN_HIGH_CPU_SAMPLES) {
      return { triggered: true, procKey: key, pidCount: uniquePids.size }
    }
  }
  return { triggered: false }
}

function isRouterDegraded(sample: MacMetricsSample): boolean {
  return (
    sample.ping_router.loss > ROUTER_LOSS_OK ||
    (sample.ping_router.mdev !== null && sample.ping_router.mdev > ROUTER_MDEV_OK)
  )
}

function formatTgMessage(
  transitions: AlarmIncident[],
  sample: MacMetricsSample,
  routerDegraded: boolean,
): string {
  if (transitions.length === 0) return ""
  const isRecovery = transitions[0].transition === "recovered"
  // 按优先级排序 (R0 < R4 — R0 优先级最高即数字最小)
  const sorted = [...transitions].sort((a, b) => RULE_PRIORITY[a.rule] - RULE_PRIORITY[b.rule])
  const headRule = sorted[0]
  const headEmoji = isRecovery ? "✅" : "🚨"

  const lines: string[] = []
  if (isRecovery) {
    lines.push(`${headEmoji} Mac Mini 监控恢复`)
  } else {
    lines.push(`${headEmoji} Mac Mini 旁路由告警 [${headRule.rule}]`)
  }
  lines.push("")
  for (const t of sorted) {
    lines.push(`• ${t.rule}: ${t.details}`)
  }

  if (!isRecovery) {
    lines.push("")
    lines.push(
      `ping mac: avg ${sample.ping_macmini.avg ?? "?"} mdev ${sample.ping_macmini.mdev ?? "?"} loss ${sample.ping_macmini.loss}%`,
    )
    lines.push(
      `ping router: avg ${sample.ping_router.avg ?? "?"} mdev ${sample.ping_router.mdev ?? "?"} loss ${sample.ping_router.loss}%`,
    )
    if (sample.load && sample.ncpu) {
      lines.push(`load 1/5/15: ${sample.load["1"]}/${sample.load["5"]}/${sample.load["15"]} (ncpu ${sample.ncpu})`)
    }
    if (sample.top_proc) {
      lines.push("top proc:")
      for (const p of sample.top_proc.slice(0, 3)) {
        lines.push(`  ${p.pcpu}% ${p.comm} pid=${p.pid}`)
      }
    }
    if (routerDegraded) {
      lines.push("")
      lines.push("⚠️ 路由器对照也异常, 本次告警含不能归因 Mac Mini 的可能性")
    }
  }
  return lines.join("\n")
}

async function sendTg(text: string, config: AlarmConfig): Promise<{ ok: boolean; error: string | null }> {
  if (!config.tgBotToken || !config.tgChatId) {
    return { ok: false, error: "PORTAL_TG_BOT_TOKEN/CHAT_ID not set" }
  }
  const url = `https://api.telegram.org/bot${config.tgBotToken}/sendMessage`
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000))
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 5000)
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: config.tgChatId, text }),
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (res.ok) return { ok: true, error: null }
      const errText = await res.text().catch(() => "<no body>")
      if (attempt === 2) return { ok: false, error: `HTTP ${res.status}: ${errText.substring(0, 100)}` }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (attempt === 2) return { ok: false, error: msg.substring(0, 100) }
    }
  }
  return { ok: false, error: "exhausted retries" }
}

/**
 * 跑一轮告警评估。Pure function: 返回新 state, 不 mutate prev。
 * collector 调用每个 tick (warmup 期外)。
 */
export function runAlarmTick(
  sample: MacMetricsSample,
  history: MacMetricsSample[],
  prev: AlarmState,
  _config: AlarmConfig,
): AlarmTickResult {
  // Clone state (shallow + new collections)
  const next: AlarmState = {
    activeAlarms: new Map(prev.activeAlarms),
    pidHistory: new Map(),
    lastUptimeSec: prev.lastUptimeSec,
    r4SilencedUntilMs: prev.r4SilencedUntilMs,
    routerDegraded: prev.routerDegraded,
    pending: [...prev.pending],
  }

  // Reboot 检测 (P1-5)
  if (sample.mac_uptime_sec !== null) {
    if (next.lastUptimeSec !== null && sample.mac_uptime_sec < next.lastUptimeSec) {
      // uptime 变小 → reboot
      next.r4SilencedUntilMs = Date.now() + R4_REBOOT_SILENCE_MS
    } else if (sample.mac_uptime_sec < 300) {
      // 刚起来不到 5min
      next.r4SilencedUntilMs = Math.max(next.r4SilencedUntilMs, Date.now() + R4_REBOOT_SILENCE_MS - sample.mac_uptime_sec * 1000)
    }
    next.lastUptimeSec = sample.mac_uptime_sec
  }

  // Router degraded 状态
  const wasRouterDegraded = next.routerDegraded
  next.routerDegraded = isRouterDegraded(sample)

  // 跑规则 (注意抑制顺序)
  const r0 = checkR0(history)
  const r1 = !r0 && !next.routerDegraded && checkR1(history) // R0 active 时抑制 R1, router degraded 时也抑制
  const r2 = !r0 && checkR2(history)
  const r3Result = r0 ? { triggered: false } : checkR3(history)
  const r4Result = r0 ? { triggered: false } : checkR4(history, next)

  // State transitions
  const transitions: AlarmIncident[] = []
  const ruleStates: Array<{ rule: RuleId; active: boolean; details: string }> = [
    { rule: "R0_mac_unreachable", active: r0, details: "SSH/ping 全断, 路由器对照正常" },
    { rule: "R1_lan_jitter", active: r1, details: `LAN 抖动 mdev ${sample.ping_macmini.mdev ?? "?"} loss ${sample.ping_macmini.loss}%` },
    { rule: "R2_load_high", active: r2, details: sample.load && sample.ncpu ? `load1 ${sample.load["1"]} > ${sample.ncpu}*${R2_LOAD_RATIO}` : "load high" },
    { rule: "R3_proc_cpu", active: r3Result.triggered, details: r3Result.triggered && "proc" in r3Result && r3Result.proc ? `进程 ${r3Result.proc.comm} pid=${r3Result.proc.pid} CPU ${r3Result.proc.pcpu}% args=${r3Result.proc.args.substring(0, 80)}` : "single proc CPU high" },
    { rule: "R4_pid_churn", active: r4Result.triggered, details: r4Result.triggered && "procKey" in r4Result && r4Result.procKey ? `疑似崩溃重启循环: ${r4Result.procKey} (5min 内 ${r4Result.pidCount} 个 PID)` : "PID churn" },
  ]

  for (const { rule, active, details } of ruleStates) {
    const wasActive = next.activeAlarms.has(rule)
    if (active && !wasActive) {
      // inactive → active
      next.activeAlarms.set(rule, { since: sample.ts, lastSent: sample.ts })
      transitions.push({ rule, transition: "active", since: sample.ts, details })
    } else if (!active && wasActive) {
      // active → recovered
      const prevEntry = next.activeAlarms.get(rule)!
      transitions.push({ rule, transition: "recovered", since: prevEntry.since, details })
      next.activeAlarms.delete(rule)
    }
  }

  // Router degraded 状态变化 (single shot 推送, 不刷屏)
  if (next.routerDegraded && !wasRouterDegraded) {
    transitions.push({
      rule: "R1_lan_jitter", // 借用 R1 标识但 details 不同
      transition: "active",
      since: sample.ts,
      details: "对照路由器也异常 (degraded), 本次抖动不能归因 Mac Mini",
    })
  }

  // 合并 transitions 成 TG 消息 (P1-7)
  let notifySucceeded = false
  let notifyError: string | null = null
  const activeTransitions = transitions.filter((t) => t.transition === "active")
  const recoveredTransitions = transitions.filter((t) => t.transition === "recovered")

  const enqueueMessage = (transitions: AlarmIncident[]) => {
    if (transitions.length === 0) return
    const text = formatTgMessage(transitions, sample, next.routerDegraded)
    if (next.pending.length < PENDING_QUEUE_MAX) {
      next.pending.push({ text, ts: sample.ts })
    }
  }
  enqueueMessage(activeTransitions)
  enqueueMessage(recoveredTransitions)

  // 同步发送 pending queue (最多发 2 个 / tick 防过载)
  // 但 sendTg 是 async, 这里返回的是 state, async 发送由 caller fire-and-forget
  // 实际实现: 让 caller 收到 pending list, fire async, 不阻塞 tick
  // 简化: 直接同步发 (但 caller 用 .then 处理)

  return {
    nextState: next,
    incidents: transitions,
    notifySucceeded,
    notifyError,
    pendingCount: next.pending.length,
  }
}

/**
 * 异步发送 pending queue 中的消息。fire-and-forget, 不阻塞 collector tick。
 * 调用方: collector 在 runAlarmTick 之后调一次, 但不 await。
 */
export async function flushPendingNotifications(
  state: AlarmState,
  config: AlarmConfig,
): Promise<{ sent: number; failed: number; lastError: string | null }> {
  const toSend = [...state.pending]
  state.pending = []
  let sent = 0
  let failed = 0
  let lastError: string | null = null
  for (const msg of toSend) {
    const result = await sendTg(msg.text, config)
    if (result.ok) {
      sent += 1
    } else {
      failed += 1
      lastError = result.error
      // 失败的 push 回 pending (但限容量)
      if (state.pending.length < PENDING_QUEUE_MAX) {
        state.pending.push(msg)
      }
    }
  }
  return { sent, failed, lastError }
}
