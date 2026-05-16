/**
 * mac-mini-collector — 后端 daemon
 *
 * 每 15s SSH 拉 Mac Mini (192.168.31.2) 状态 + ping 路由器对照，落 ring buffer (120 sample / 30min)，
 * 配合 mac-mini-alarms 跑告警规则、推 TG。
 *
 * 起源：2026-05-16 OpenClaw 死循环全屋 Surge 抖动事件。详见
 * docs/superpowers/specs/2026-05-16-mac-mini-monitoring-design.md
 *
 * 关键设计点（来自 codex adversarial review）：
 * - tick 全局 deadline 10s + 上 tick 未完则跳过 (collector_lag++)
 * - shell 命令一律 execFile + timeout，不拼字符串
 * - SSH ControlPath 走容器内可写目录 /tmp/portal-ssh-mux/%C (read-only mount 不可写)
 * - 启动后 60s warmup，期内采集但不调 alarm engine
 */
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { runAlarmTick, flushPendingNotifications, type AlarmState, createInitialAlarmState } from "./mac-mini-alarms"

const execFileP = promisify(execFile)

export interface PingResult {
  avg: number | null
  max: number | null
  mdev: number | null
  loss: number // 0-100
}

export interface ProcInfo {
  pid: number
  pcpu: number
  pmem: number
  comm: string
  args: string
}

export interface MacMetricsSample {
  ts: string
  ping_macmini: PingResult
  ping_router: PingResult
  ssh_ok: boolean
  ssh_error: string | null
  mac_uptime_sec: number | null
  ncpu: number | null
  load: { "1": number; "5": number; "15": number } | null
  top_proc: ProcInfo[] | null
}

const RING_CAPACITY = 120 // 30min @ 15s
const TICK_INTERVAL_MS = 15_000
const TICK_DEADLINE_MS = 10_000
const WARMUP_MS = 60_000

const HOST_MAC = process.env.MAC_MINI_HOST || "192.168.31.2"
const HOST_ROUTER = process.env.ROUTER_HOST || "192.168.31.1"
const SSH_USER = process.env.MAC_MINI_SSH_USER || "jiaxu"
const SSH_KEY = process.env.MAC_MINI_SSH_KEY || "/data/portal-state/.ssh/id_ed25519_macmini"
const SSH_KNOWN_HOSTS = process.env.MAC_MINI_SSH_KNOWN_HOSTS || "/data/portal-state/.ssh/known_hosts_macmini"

// 跨模块 bundle 共享 state — Next.js 编译时 instrumentation 和 API routes 是独立 bundle,
// module-level state 不共享 (各自 import 拿到不同 module instance)。挂 globalThis 强制 singleton。
interface CollectorRuntime {
  ring: MacMetricsSample[]
  collectorStartedAt: string | null
  lastTickAt: string | null
  lastSuccessAt: string | null
  consecutiveFailures: number
  collectorLag: number
  lastNotifyError: string | null
  pendingNotifications: number
  inFlightTick: Promise<void> | null
  alarmState: AlarmState
  intervalHandle: NodeJS.Timeout | null
}

const G = globalThis as typeof globalThis & { __macMiniCollector?: CollectorRuntime }

function rt(): CollectorRuntime {
  if (!G.__macMiniCollector) {
    G.__macMiniCollector = {
      ring: [],
      collectorStartedAt: null,
      lastTickAt: null,
      lastSuccessAt: null,
      consecutiveFailures: 0,
      collectorLag: 0,
      lastNotifyError: null,
      pendingNotifications: 0,
      inFlightTick: null,
      alarmState: createInitialAlarmState(),
      intervalHandle: null,
    }
  }
  return G.__macMiniCollector
}

function parsePing(stdout: string): PingResult {
  // iputils: "rtt min/avg/max/mdev = 0.230/0.300/0.520/0.099 ms"
  // and "3 packets transmitted, 3 received, 0% packet loss, time 2002ms"
  const result: PingResult = { avg: null, max: null, mdev: null, loss: 100 }
  const rttMatch = stdout.match(/rtt min\/avg\/max\/mdev = ([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)/)
  if (rttMatch) {
    result.avg = parseFloat(rttMatch[2])
    result.max = parseFloat(rttMatch[3])
    result.mdev = parseFloat(rttMatch[4])
  }
  const lossMatch = stdout.match(/(\d+)% packet loss/)
  if (lossMatch) result.loss = parseInt(lossMatch[1], 10)
  return result
}

async function pingHost(host: string, signal: AbortSignal): Promise<PingResult> {
  try {
    const { stdout } = await execFileP("ping", ["-c", "3", "-W", "2", host], {
      timeout: 5000,
      signal,
    })
    return parsePing(stdout)
  } catch {
    return { avg: null, max: null, mdev: null, loss: 100 }
  }
}

interface SshScriptResult {
  uptime_sec: number
  ncpu: number
  load: [number, number, number]
  top_proc: ProcInfo[]
}

async function sshFetch(
  signal: AbortSignal,
): Promise<{ ok: boolean; error: string | null; data: SshScriptResult | null }> {
  try {
    const { stdout } = await execFileP(
      "ssh",
      [
        "-i", SSH_KEY,
        "-o", `UserKnownHostsFile=${SSH_KNOWN_HOSTS}`,
        "-o", "StrictHostKeyChecking=yes",
        "-o", "ControlMaster=auto",
        "-o", "ControlPath=/tmp/portal-ssh-mux/%C",
        "-o", "ControlPersist=10m",
        "-o", "ConnectTimeout=2",
        "-o", "ServerAliveInterval=2",
        "-o", "ServerAliveCountMax=1",
        "-o", "BatchMode=yes",
        `${SSH_USER}@${HOST_MAC}`,
      ],
      { timeout: 5000, signal },
    )
    const data = JSON.parse(stdout) as SshScriptResult
    return { ok: true, error: null, data }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg.substring(0, 200), data: null }
  }
}

async function collectSample(): Promise<MacMetricsSample> {
  const controller = new AbortController()
  const deadlineTimer = setTimeout(() => controller.abort(), TICK_DEADLINE_MS)
  try {
    const ts = new Date().toISOString()
    const [pingMac, pingRouter, sshResult] = await Promise.all([
      pingHost(HOST_MAC, controller.signal),
      pingHost(HOST_ROUTER, controller.signal),
      sshFetch(controller.signal),
    ])
    return {
      ts,
      ping_macmini: pingMac,
      ping_router: pingRouter,
      ssh_ok: sshResult.ok,
      ssh_error: sshResult.error,
      mac_uptime_sec: sshResult.data?.uptime_sec ?? null,
      ncpu: sshResult.data?.ncpu ?? null,
      load: sshResult.data?.load
        ? { "1": sshResult.data.load[0], "5": sshResult.data.load[1], "15": sshResult.data.load[2] }
        : null,
      top_proc: sshResult.data?.top_proc ?? null,
    }
  } finally {
    clearTimeout(deadlineTimer)
  }
}

function isInWarmup(): boolean {
  const s = rt()
  if (!s.collectorStartedAt) return true
  return Date.now() - new Date(s.collectorStartedAt).getTime() < WARMUP_MS
}

async function tick(): Promise<void> {
  const s = rt()
  if (s.inFlightTick) {
    s.collectorLag += 1
    console.warn(`[mac-mini-collector] tick skipped (prev still running), lag=${s.collectorLag}`)
    return
  }
  s.inFlightTick = (async () => {
    s.lastTickAt = new Date().toISOString()
    try {
      const sample = await collectSample()
      s.ring.push(sample)
      if (s.ring.length > RING_CAPACITY) s.ring.shift()
      s.lastSuccessAt = sample.ts
      s.consecutiveFailures = 0

      // Alarm engine — warmup 期内不跑
      if (!isInWarmup()) {
        const config = {
          tgBotToken: process.env.PORTAL_TG_BOT_TOKEN || "",
          tgChatId: process.env.PORTAL_TG_CHAT_ID || "",
        }
        const result = runAlarmTick(sample, s.ring, s.alarmState, config)
        s.alarmState = result.nextState
        s.pendingNotifications = result.pendingCount

        // fire-and-forget flush pending notifications
        if (s.alarmState.pending.length > 0) {
          void flushPendingNotifications(s.alarmState, config).then((r) => {
            s.lastNotifyError = r.lastError
            s.pendingNotifications = s.alarmState.pending.length
          })
        }
      }
    } catch (e) {
      s.consecutiveFailures += 1
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[mac-mini-collector] tick failed:`, msg)
    } finally {
      s.inFlightTick = null
    }
  })()
  await s.inFlightTick
}

/** 启动 collector。幂等：已启动则 no-op */
export function start(): void {
  const s = rt()
  if (s.intervalHandle) return
  s.collectorStartedAt = new Date().toISOString()
  console.log(`[mac-mini-collector] starting tick=${TICK_INTERVAL_MS}ms, warmup=${WARMUP_MS}ms`)
  // 立即跑一次 + 然后每 15s
  void tick()
  s.intervalHandle = setInterval(() => void tick(), TICK_INTERVAL_MS)
}

export function getLatest(): MacMetricsSample | null {
  const s = rt()
  return s.ring.length > 0 ? s.ring[s.ring.length - 1] : null
}

export function getHistory(n: number = 30): MacMetricsSample[] {
  return rt().ring.slice(-n)
}

export interface CollectorHealth {
  started_at: string | null
  last_tick_at: string | null
  last_success_at: string | null
  tick_age_ms: number | null
  consecutive_failures: number
  collector_lag: number
  last_notify_error: string | null
  pending_notifications: number
  capture_point: string
  warmup: boolean
}

export function getCollectorHealth(): CollectorHealth {
  const s = rt()
  const lastTickMs = s.lastTickAt ? new Date(s.lastTickAt).getTime() : 0
  return {
    started_at: s.collectorStartedAt,
    last_tick_at: s.lastTickAt,
    last_success_at: s.lastSuccessAt,
    tick_age_ms: lastTickMs > 0 ? Date.now() - lastTickMs : null,
    consecutive_failures: s.consecutiveFailures,
    collector_lag: s.collectorLag,
    last_notify_error: s.lastNotifyError,
    pending_notifications: s.pendingNotifications,
    capture_point: "jiaxu-portal-container@share-network",
    warmup: isInWarmup(),
  }
}

export function getActiveAlarms(): string[] {
  return Array.from(rt().alarmState.activeAlarms.keys())
}
