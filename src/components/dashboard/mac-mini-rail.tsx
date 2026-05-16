/**
 * MacMiniRail — Mac Mini 旁路由健康监控卡片
 *
 * 数据源: GET /api/mac-metrics (3s polling, 读后端 ring buffer 缓存, 不触发新 SSH)
 * 详见 docs/superpowers/specs/2026-05-16-mac-mini-monitoring-design.md §4.3
 */
"use client"

import { useEffect, useState, useMemo, useRef } from "react"
import { cn } from "@/lib/utils"

interface MacMetricsResponse {
  ts: string | null
  sample_age_ms: number | null
  ping_macmini: { avg: number | null; max: number | null; mdev: number | null; loss: number } | null
  ping_router: { avg: number | null; max: number | null; mdev: number | null; loss: number } | null
  ssh_ok: boolean | null
  mac_uptime_sec: number | null
  ncpu: number | null
  load: { "1": number; "5": number; "15": number } | null
  top_proc: Array<{ pid: number; pcpu: number; pmem: number; comm: string; args?: string }> | null
  history: { mdev: (number | null)[]; load1: (number | null)[] }
  alarms_active: string[]
  collector: {
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
}

const POLL_MS = 3000
const HISTORY_BARS = 30
const STORAGE_KEY = "jiaxu.macminirail.expanded"

function sparklinePath(values: (number | null)[], w: number, h: number, max: number): string {
  const vals = values.slice(-HISTORY_BARS)
  if (vals.length < 2) return ""
  const step = w / (HISTORY_BARS - 1)
  const pad = HISTORY_BARS - vals.length
  const y = (v: number) => h - (Math.min(v, max) / max) * (h - 2) - 1
  const pts = vals.map((v, i) => ({ x: (pad + i) * step, y: v === null ? h - 1 : y(v) }))
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ")
}

function fmtUptime(secs: number | null): string {
  if (secs === null || !Number.isFinite(secs)) return "—"
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function MacMiniRail() {
  const [data, setData] = useState<MacMetricsResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const tickAgeRef = useRef<number>(0)
  const [, setNow] = useState(0)

  useEffect(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY)
      if (v === "1") setExpanded(true)
    } catch {}
    setHydrated(true)
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const r = await fetch("/api/mac-metrics", { cache: "no-store" })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j = (await r.json()) as MacMetricsResponse
        if (cancelled) return
        setData(j)
        setErr(null)
        tickAgeRef.current = j.collector.tick_age_ms ?? 0
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      }
    }
    load()
    const id = setInterval(load, POLL_MS)
    // 每秒更新 tick_age 显示, 不需要刷数据
    const tickId = setInterval(() => setNow((v) => v + 1), 1000)
    return () => {
      cancelled = true
      clearInterval(id)
      clearInterval(tickId)
    }
  }, [])

  const status = useMemo<"green" | "yellow" | "red">(() => {
    if (!data) return "yellow"
    if (data.alarms_active.length > 0) return "red"
    if (data.ssh_ok === false) return "red"
    if (data.collector.tick_age_ms !== null && data.collector.tick_age_ms > 60_000) return "red"
    if (data.ping_macmini && data.ping_macmini.loss > 0) return "red"
    const mdev = data.ping_macmini?.mdev ?? 0
    const load1 = data.load?.["1"] ?? 0
    const ncpu = data.ncpu ?? 1
    if (mdev > 20 || load1 > ncpu * 0.8) return "red"
    if (mdev > 5 || load1 > ncpu * 0.5) return "yellow"
    if (data.collector.tick_age_ms !== null && data.collector.tick_age_ms > 30_000) return "yellow"
    return "green"
  }, [data])

  const toggle = () => {
    const next = !expanded
    setExpanded(next)
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0")
    } catch {}
  }

  if (!hydrated) return null

  return (
    <section
      className={cn(
        "mb-3 rounded-lg border bg-zinc-950/40 px-3 py-2 text-xs",
        status === "red" && "border-rose-500/40 bg-rose-500/[0.02]",
        status === "yellow" && "border-amber-500/30",
        status === "green" && "border-zinc-800/70",
      )}
      aria-label="Mac Mini 旁路由监控"
    >
      <div className="flex items-center gap-2">
        <button onClick={toggle} className="flex items-center gap-2 text-zinc-300 hover:text-white">
          <span
            className={cn(
              "inline-block w-2 h-2 rounded-full",
              status === "green" && "bg-emerald-400",
              status === "yellow" && "bg-amber-400",
              status === "red" && "bg-rose-500 animate-pulse",
            )}
          />
          <span className="font-medium">Mac Mini 旁路由</span>
          <span className="text-[10px] text-zinc-500">[container view]</span>
        </button>

        <div className="ml-auto flex items-center gap-3 text-zinc-400">
          {data?.ping_macmini && (
            <span>
              ping mdev <span className="text-zinc-200">{data.ping_macmini.mdev ?? "—"}</span>ms
              {data.ping_macmini.loss > 0 && (
                <span className="ml-1 text-rose-400">loss {data.ping_macmini.loss}%</span>
              )}
            </span>
          )}
          {data?.load && data?.ncpu && (
            <span>
              load <span className="text-zinc-200">{data.load["1"].toFixed(2)}</span>/{data.ncpu}
            </span>
          )}
          <span
            className={cn(
              data?.ssh_ok === false && "text-rose-400",
              data?.ssh_ok === true && "text-emerald-500/70",
            )}
          >
            ssh {data?.ssh_ok === true ? "ok" : data?.ssh_ok === false ? "down" : "?"}
          </span>
          <button onClick={toggle} className="text-zinc-500 hover:text-zinc-300">
            {expanded ? "▴" : "▾"}
          </button>
        </div>
      </div>

      {/* sparklines (always visible row) */}
      {data && (
        <div className="mt-2 flex items-center gap-3 text-[10px] text-zinc-500">
          <span className="w-12">mdev:</span>
          <svg width={120} height={20} className="overflow-visible">
            <path
              d={sparklinePath(data.history.mdev, 120, 20, Math.max(20, ...data.history.mdev.map((v) => v ?? 0)))}
              fill="none"
              stroke={status === "red" ? "#fb7185" : "#34d399"}
              strokeWidth={1.2}
            />
          </svg>
          <span className="w-12">load1:</span>
          <svg width={120} height={20} className="overflow-visible">
            <path
              d={sparklinePath(
                data.history.load1,
                120,
                20,
                Math.max(data.ncpu ?? 1, ...data.history.load1.map((v) => v ?? 0)),
              )}
              fill="none"
              stroke={status === "red" ? "#fb7185" : "#a78bfa"}
              strokeWidth={1.2}
            />
          </svg>
        </div>
      )}

      {expanded && data && (
        <div className="mt-3 space-y-1 border-t border-zinc-800/50 pt-2 text-[11px] text-zinc-400">
          <div className="flex gap-3">
            <span>vs router:</span>
            <span>
              mdev {data.ping_router?.mdev ?? "—"}ms loss {data.ping_router?.loss ?? 0}%
            </span>
            <span>mac uptime: {fmtUptime(data.mac_uptime_sec)}</span>
          </div>
          {data.top_proc && data.top_proc.length > 0 && (
            <div>
              <div className="text-zinc-500">top proc:</div>
              <ul className="ml-2 space-y-0.5">
                {data.top_proc.slice(0, 5).map((p) => (
                  <li key={p.pid} className="font-mono">
                    <span className={cn(p.pcpu > 50 && "text-rose-400")}>{p.pcpu.toFixed(1).padStart(5, " ")}%</span>{" "}
                    <span className="text-zinc-500">pid {p.pid.toString().padStart(5, " ")}</span>{" "}
                    <span>{p.comm}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.alarms_active.length > 0 && (
            <div className="text-rose-400">
              alarms active: {data.alarms_active.join(", ")}
            </div>
          )}
          <div className="text-zinc-600">
            collector: tick_age{" "}
            <span className={cn((data.collector.tick_age_ms ?? 0) > 30_000 && "text-rose-400")}>
              {data.collector.tick_age_ms !== null ? `${Math.round(data.collector.tick_age_ms / 1000)}s` : "?"}
            </span>
            {data.collector.collector_lag > 0 && (
              <span className="text-amber-400"> lag {data.collector.collector_lag}</span>
            )}
            {data.collector.warmup && <span className="ml-2 text-amber-400">warmup</span>}
            {data.collector.consecutive_failures > 0 && (
              <span className="ml-2 text-rose-400">fail x{data.collector.consecutive_failures}</span>
            )}
            {data.collector.last_notify_error && (
              <div className="text-rose-400">TG error: {data.collector.last_notify_error}</div>
            )}
            <span className="ml-2">{data.collector.capture_point}</span>
          </div>
        </div>
      )}

      {err && <div className="mt-1 text-rose-400">err: {err}</div>}
    </section>
  )
}
