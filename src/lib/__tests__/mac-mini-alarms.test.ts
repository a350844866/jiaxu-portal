/**
 * mac-mini-alarms 单元测试
 *
 * 关键验证 (codex review 列的 P0/P1 都要覆盖):
 * - R0 抑制 R1/R2/R3/R4
 * - R4 误伤排除 (pcpu<30% 不触发)
 * - router degraded 抑制 R1
 * - reboot 静默 R4
 * - 告警优先级合并
 */
import { describe, it, expect } from "vitest"
import {
  runAlarmTick,
  createInitialAlarmState,
  type AlarmState,
} from "@/lib/mac-mini-alarms"
import type { MacMetricsSample, ProcInfo } from "@/lib/mac-mini-collector"

const DEFAULT_CONFIG = { tgBotToken: "", tgChatId: "" } // 不发 TG (避免测试调外部)

function makeSample(overrides: Partial<MacMetricsSample> = {}, tsOffsetMs = 0): MacMetricsSample {
  const ts = new Date(Date.now() + tsOffsetMs).toISOString()
  return {
    ts,
    ping_macmini: { avg: 0.3, max: 0.5, mdev: 0.08, loss: 0 },
    ping_router: { avg: 0.7, max: 0.8, mdev: 0.04, loss: 0 },
    ssh_ok: true,
    ssh_error: null,
    mac_uptime_sec: 3600,
    ncpu: 8,
    load: { "1": 1.0, "5": 1.0, "15": 1.0 },
    top_proc: [],
    ...overrides,
  }
}

function makeProc(args: string, pid: number, pcpu: number): ProcInfo {
  return { pid, pcpu, pmem: 1.0, comm: "/usr/bin/x", args }
}

/** 跑 N 个相同 sample (模拟连续 tick) */
function feedSamples(samples: MacMetricsSample[]) {
  let state = createInitialAlarmState()
  const history: MacMetricsSample[] = []
  const allIncidents: ReturnType<typeof runAlarmTick>["incidents"][] = []
  for (const s of samples) {
    history.push(s)
    const result = runAlarmTick(s, history, state, DEFAULT_CONFIG)
    state = result.nextState
    allIncidents.push(result.incidents)
  }
  return { state, history, allIncidents }
}

describe("R0_mac_unreachable", () => {
  it("ssh_ok=false 持续 2 tick + router 正常 → 触发 R0", () => {
    const samples = [
      makeSample({ ssh_ok: false, ssh_error: "Connection refused" }),
      makeSample({ ssh_ok: false, ssh_error: "Connection refused" }),
    ]
    const { state } = feedSamples(samples)
    expect(state.activeAlarms.has("R0_mac_unreachable")).toBe(true)
  })

  it("ssh_ok=false 但 router 也 down → R0 不触发 (degraded 状态)", () => {
    const samples = [
      makeSample({ ssh_ok: false, ping_router: { avg: null, max: null, mdev: null, loss: 100 } }),
      makeSample({ ssh_ok: false, ping_router: { avg: null, max: null, mdev: null, loss: 100 } }),
    ]
    const { state } = feedSamples(samples)
    expect(state.activeAlarms.has("R0_mac_unreachable")).toBe(false)
    expect(state.routerDegraded).toBe(true)
  })
})

describe("R1_lan_jitter + R0 suppression", () => {
  it("mdev>20ms 持续 3 tick 且 router 正常 → 触发 R1", () => {
    const samples = [
      makeSample({ ping_macmini: { avg: 30, max: 150, mdev: 46, loss: 0 } }),
      makeSample({ ping_macmini: { avg: 30, max: 150, mdev: 46, loss: 0 } }),
      makeSample({ ping_macmini: { avg: 30, max: 150, mdev: 46, loss: 0 } }),
    ]
    const { state } = feedSamples(samples)
    expect(state.activeAlarms.has("R1_lan_jitter")).toBe(true)
  })

  it("R0 active 时抑制 R1 (即使 ping mdev 高也不触发 R1)", () => {
    const samples = Array(3).fill(null).map(() =>
      makeSample({
        ssh_ok: false,
        ping_macmini: { avg: 30, max: 150, mdev: 46, loss: 100 },
        ping_router: { avg: 0.7, max: 0.8, mdev: 0.04, loss: 0 },
      })
    )
    const { state } = feedSamples(samples)
    expect(state.activeAlarms.has("R0_mac_unreachable")).toBe(true)
    expect(state.activeAlarms.has("R1_lan_jitter")).toBe(false)
  })

  it("router 也异常时 R1 不触发 (degraded 抑制)", () => {
    const samples = Array(3).fill(null).map(() =>
      makeSample({
        ping_macmini: { avg: 30, max: 150, mdev: 46, loss: 0 },
        ping_router: { avg: 20, max: 100, mdev: 30, loss: 0 },
      })
    )
    const { state } = feedSamples(samples)
    expect(state.activeAlarms.has("R1_lan_jitter")).toBe(false)
    expect(state.routerDegraded).toBe(true)
  })
})

describe("R4_pid_churn (这次 OpenClaw 事件的最强信号)", () => {
  it("同一 args 在 5min 内 ≥3 个 PID 且 pcpu>30% → 触发 R4", () => {
    const OPENCLAW = "/opt/homebrew/opt/node@22/bin/node /opt/homebrew/lib/node_modules/openclaw/dist/index.js gateway --port 18789"
    const samples: MacMetricsSample[] = []
    // 模拟 OpenClaw 反复重启: PID 51377 → 52421 → 52800, 每个都 60% CPU
    samples.push(makeSample({ top_proc: [makeProc(OPENCLAW, 51377, 65)] }, 0))
    samples.push(makeSample({ top_proc: [makeProc(OPENCLAW, 52421, 70)] }, 30_000))
    samples.push(makeSample({ top_proc: [makeProc(OPENCLAW, 52800, 60)] }, 60_000))
    const { state } = feedSamples(samples)
    expect(state.activeAlarms.has("R4_pid_churn")).toBe(true)
  })

  it("R4 误伤防护: 同 args 3 个 PID 但 pcpu 都 <30% → 不触发 (zsh/sh/GoogleUpdater 这类)", () => {
    const ZSH = "/bin/zsh -i"
    const samples: MacMetricsSample[] = []
    samples.push(makeSample({ top_proc: [makeProc(ZSH, 1001, 5)] }, 0))
    samples.push(makeSample({ top_proc: [makeProc(ZSH, 1002, 8)] }, 30_000))
    samples.push(makeSample({ top_proc: [makeProc(ZSH, 1003, 6)] }, 60_000))
    const { state } = feedSamples(samples)
    expect(state.activeAlarms.has("R4_pid_churn")).toBe(false)
  })

  it("Mac Mini reboot (uptime 变小) → 静默 R4 5min", () => {
    const PROC = "/usr/bin/foo"
    const samples: MacMetricsSample[] = []
    // 先建立 high CPU PID churn 历史
    samples.push(makeSample({ mac_uptime_sec: 7200, top_proc: [makeProc(PROC, 100, 60)] }, 0))
    samples.push(makeSample({ mac_uptime_sec: 7230, top_proc: [makeProc(PROC, 101, 65)] }, 30_000))
    samples.push(makeSample({ mac_uptime_sec: 7260, top_proc: [makeProc(PROC, 102, 70)] }, 60_000))
    // 然后 Mac 重启 (uptime 变小)
    samples.push(makeSample({ mac_uptime_sec: 60, top_proc: [makeProc(PROC, 200, 80)] }, 90_000))
    const { state } = feedSamples(samples)
    // R4 应被 reboot 静默清掉
    expect(state.r4SilencedUntilMs).toBeGreaterThan(Date.now())
  })
})

describe("R2_load_high + R3_proc_cpu", () => {
  it("load1 > ncpu*0.8 持续 12 tick → 触发 R2", () => {
    const samples = Array(12).fill(null).map(() =>
      makeSample({ load: { "1": 7.0, "5": 7.0, "15": 7.0 }, ncpu: 8 }) // 7 > 8*0.8=6.4
    )
    const { state } = feedSamples(samples)
    expect(state.activeAlarms.has("R2_load_high")).toBe(true)
  })

  it("单进程 CPU>80% 持续 8 tick → 触发 R3", () => {
    const samples = Array(8).fill(null).map((_, i) =>
      makeSample({ top_proc: [makeProc("/usr/bin/heavy", 999, 95)] }, i * 1000)
    )
    const { state } = feedSamples(samples)
    expect(state.activeAlarms.has("R3_proc_cpu")).toBe(true)
  })

  it("R0 active 时抑制 R2/R3", () => {
    const samples = Array(12).fill(null).map(() =>
      makeSample({
        ssh_ok: false,
        load: { "1": 7.0, "5": 7.0, "15": 7.0 },
        top_proc: [makeProc("/usr/bin/heavy", 999, 95)],
      })
    )
    const { state } = feedSamples(samples)
    expect(state.activeAlarms.has("R0_mac_unreachable")).toBe(true)
    expect(state.activeAlarms.has("R2_load_high")).toBe(false)
    expect(state.activeAlarms.has("R3_proc_cpu")).toBe(false)
  })
})

describe("recovery (active → recovered)", () => {
  it("R1 触发后下个 tick 正常 → recovery transition", () => {
    let state: AlarmState = createInitialAlarmState()
    const history: MacMetricsSample[] = []

    // 触发 R1
    for (let i = 0; i < 3; i++) {
      const s = makeSample({ ping_macmini: { avg: 30, max: 150, mdev: 46, loss: 0 } })
      history.push(s)
      state = runAlarmTick(s, history, state, DEFAULT_CONFIG).nextState
    }
    expect(state.activeAlarms.has("R1_lan_jitter")).toBe(true)

    // 接下来 3 tick 正常
    for (let i = 0; i < 3; i++) {
      const s = makeSample() // default mdev 0.08
      history.push(s)
      state = runAlarmTick(s, history, state, DEFAULT_CONFIG).nextState
    }
    expect(state.activeAlarms.has("R1_lan_jitter")).toBe(false)
  })
})
