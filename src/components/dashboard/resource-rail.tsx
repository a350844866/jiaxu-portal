"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface Metrics {
  ts: string
  cpu: { percent: number; cores: number }
  mem: { total: number; used: number; percent: number }
  disk: { total: number; used: number; percent: number; path: string }
  load: { "1": number; "5": number; "15": number }
  uptime: number
}

const HISTORY = 60
const HIST_BARS = 30
const POLL_MS = 3000
const STORAGE_KEY = "jiaxu.rail.expanded"

type Channel = "cpu" | "mem" | "disk" | "load"

const CHANNELS: Record<
  Channel,
  { label: string; stroke: string; fill: string; glow: string }
> = {
  cpu:  { label: "CPU",  stroke: "#34d399", fill: "rgba(52, 211, 153, 0.18)", glow: "rgba(52, 211, 153, 0.35)" },
  mem:  { label: "MEM",  stroke: "#fbbf24", fill: "rgba(251, 191, 36, 0.18)", glow: "rgba(251, 191, 36, 0.35)" },
  disk: { label: "DISK", stroke: "#38bdf8", fill: "rgba(56, 189, 248, 0.18)", glow: "rgba(56, 189, 248, 0.30)" },
  load: { label: "LOAD", stroke: "#a78bfa", fill: "rgba(167, 139, 250, 0.18)", glow: "rgba(167, 139, 250, 0.35)" },
}

const WARN = { stroke: "#fb7185", fill: "rgba(251, 113, 133, 0.20)", glow: "rgba(251, 113, 133, 0.45)" }

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—"
  if (n >= 1024 ** 4) return (n / 1024 ** 4).toFixed(2) + "T"
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(1) + "G"
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(0) + "M"
  if (n >= 1024) return (n / 1024).toFixed(0) + "K"
  return n.toFixed(0) + "B"
}

function fmtUptime(secs: number, short = false): string {
  if (!Number.isFinite(secs) || secs <= 0) return "—"
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (short) {
    if (d > 0) return `${d}d ${h}h`
    if (h > 0) return `${h}h ${m}m`
    return `${m}m`
  }
  return `${d}d ${h}h ${m}m`
}

function pct(n: number): string {
  if (!Number.isFinite(n)) return "—"
  return Math.round(n).toString()
}

function sparklinePath(
  values: number[],
  w: number,
  h: number,
  max: number,
  fill = false
): string {
  if (values.length < 2) return ""
  const step = w / (HISTORY - 1)
  const y = (v: number) => h - (Math.min(v, max) / max) * (h - 2) - 1
  const pad = HISTORY - values.length
  const pts = values.map((v, i) => ({ x: (pad + i) * step, y: y(v) }))
  const line = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ")
  if (!fill) return line
  const first = pts[0]
  const last = pts[pts.length - 1]
  return `${line} L${last.x.toFixed(1)} ${h} L${first.x.toFixed(1)} ${h} Z`
}

export function ResourceRail() {
  const [data, setData] = useState<Metrics | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const histRef = useRef<Record<Channel, number[]>>({
    cpu: [],
    mem: [],
    disk: [],
    load: [],
  })
  const [, setHistVersion] = useState(0)

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
        const r = await fetch("/api/metrics", { cache: "no-store" })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j = (await r.json()) as Metrics
        if (cancelled) return
        setData(j)
        setErr(null)
        const h = histRef.current
        h.cpu.push(j.cpu.percent)
        h.mem.push(j.mem.percent)
        h.disk.push(j.disk.percent)
        // normalise load to a comparable 0-100 scale using cores * 1 = 100%
        const loadNorm = Math.min(100, (j.load["1"] / Math.max(1, j.cpu.cores)) * 100)
        h.load.push(loadNorm)
        for (const k of ["cpu", "mem", "disk", "load"] as Channel[]) {
          if (h[k].length > HISTORY) h[k].splice(0, h[k].length - HISTORY)
        }
        setHistVersion((v) => v + 1)
      } catch (e) {
        if (!cancelled) setErr(String(e))
      }
    }
    load()
    const id = setInterval(load, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const toggle = () => {
    const next = !expanded
    setExpanded(next)
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0")
    } catch {}
  }

  const warn = useMemo(() => {
    if (!data) return { cpu: false, mem: false, disk: false, load: false }
    return {
      cpu: data.cpu.percent > 85,
      mem: data.mem.percent > 85,
      disk: data.disk.percent > 90,
      load: data.load["1"] > data.cpu.cores * 1.5,
    }
  }, [data])

  const anyWarn = warn.cpu || warn.mem || warn.disk || warn.load

  return (
    <section
      className={cn(
        "relative mb-6 overflow-hidden border-y",
        anyWarn
          ? "border-rose-500/30 bg-rose-500/[0.015]"
          : "border-zinc-800/70 bg-zinc-950/40"
      )}
      aria-label="服务器资源负载"
    >
      {/* scanline */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px"
        style={{
          background: `linear-gradient(90deg, transparent 0%, ${
            anyWarn ? WARN.stroke : CHANNELS.cpu.stroke
          } 50%, transparent 100%)`,
          animation: "rail-scan 7s ease-in-out infinite",
          opacity: 0.55,
        }}
      />

      {/* collapsed bar */}
      <button
        onClick={toggle}
        className="group flex w-full items-center gap-4 px-4 py-2.5 text-left sm:gap-6"
        aria-expanded={expanded}
      >
        {/* recording dot + HOST tag */}
        <div className="flex shrink-0 items-center gap-2">
          <span
            aria-hidden
            className={cn(
              "inline-block h-1.5 w-1.5 rounded-full",
              err
                ? "bg-rose-500"
                : anyWarn
                ? "bg-rose-400"
                : "bg-emerald-400"
            )}
            style={{ animation: err || data ? "rail-rec 1.6s ease-in-out infinite" : undefined }}
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            HOST
          </span>
        </div>

        {/* histogram */}
        <div className="hidden shrink-0 sm:block">
          <Histogram values={histRef.current.cpu} warn={warn.cpu} />
        </div>

        {/* readouts */}
        <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-6">
          <Readout label="CPU" value={data ? pct(data.cpu.percent) + "%" : "—"} warn={warn.cpu} tone={CHANNELS.cpu.stroke} />
          <Readout label="MEM" value={data ? pct(data.mem.percent) + "%" : "—"} warn={warn.mem} tone={CHANNELS.mem.stroke} />
          <Readout label="DISK" value={data ? pct(data.disk.percent) + "%" : "—"} warn={warn.disk} tone={CHANNELS.disk.stroke} />
          <Readout
            label="LOAD"
            value={data ? data.load["1"].toFixed(2) : "—"}
            warn={warn.load}
            tone={CHANNELS.load.stroke}
          />
        </div>

        {/* uptime + caret */}
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden font-mono text-[11px] text-zinc-500 tabular-nums md:inline">
            up {data ? fmtUptime(data.uptime, true) : "—"}
          </span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-zinc-500 transition-transform duration-200",
              expanded && "rotate-180"
            )}
          />
        </div>
      </button>

      {/* expanded panels */}
      {hydrated && (
        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-300 ease-out",
            expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="grid gap-3 px-4 pb-4 pt-1 sm:grid-cols-2 lg:grid-cols-4">
              <Panel
                channel="cpu"
                values={histRef.current.cpu}
                primary={data ? pct(data.cpu.percent) + "%" : "—"}
                detail={data ? `${data.cpu.cores} CORES` : "—"}
                max={100}
                warn={warn.cpu}
              />
              <Panel
                channel="mem"
                values={histRef.current.mem}
                primary={data ? pct(data.mem.percent) + "%" : "—"}
                detail={
                  data
                    ? `${fmtBytes(data.mem.used)} / ${fmtBytes(data.mem.total)}`
                    : "—"
                }
                max={100}
                warn={warn.mem}
              />
              <Panel
                channel="disk"
                values={histRef.current.disk}
                primary={data ? pct(data.disk.percent) + "%" : "—"}
                detail={
                  data
                    ? `${fmtBytes(data.disk.used)} / ${fmtBytes(data.disk.total)}  ${data.disk.path}`
                    : "—"
                }
                max={100}
                warn={warn.disk}
              />
              <Panel
                channel="load"
                values={histRef.current.load}
                primary={data ? data.load["1"].toFixed(2) : "—"}
                detail={
                  data
                    ? `5m ${data.load["5"].toFixed(2)}  ·  15m ${data.load["15"].toFixed(2)}  ·  ${fmtUptime(data.uptime)}`
                    : "—"
                }
                max={Math.max(4, data ? data.cpu.cores * 2 : 4)}
                warn={warn.load}
              />
            </div>
          </div>
        </div>
      )}

      {err && !data && (
        <div className="px-4 pb-3 font-mono text-[11px] text-rose-400/80">
          metrics unavailable · {err}
        </div>
      )}

      <style>{`
        @keyframes rail-scan {
          0%   { transform: translateX(-40%); opacity: 0; }
          15%  { opacity: 1; }
          85%  { opacity: 1; }
          100% { transform: translateX(140%); opacity: 0; }
        }
        @keyframes rail-rec {
          0%, 55% { opacity: 1; box-shadow: 0 0 6px currentColor; }
          55.01%, 100% { opacity: 0.35; box-shadow: 0 0 0 currentColor; }
        }
      `}</style>
    </section>
  )
}

function Readout({
  label,
  value,
  warn,
  tone,
}: {
  label: string
  value: string
  warn: boolean
  tone: string
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </span>
      <span
        className="font-mono text-sm font-medium tabular-nums"
        style={{ color: warn ? WARN.stroke : tone }}
      >
        {value}
      </span>
    </div>
  )
}

function Histogram({
  values,
  warn,
}: {
  values: number[]
  warn: boolean
}) {
  const stroke = warn ? WARN.stroke : CHANNELS.cpu.stroke
  const tail = values.slice(-HIST_BARS)
  const pad = HIST_BARS - tail.length
  return (
    <div className="flex h-4 items-end gap-px" aria-hidden>
      {Array.from({ length: HIST_BARS }, (_, i) => {
        const idx = i - pad
        const v = idx >= 0 ? tail[idx] : null
        const h = v === null ? 1 : Math.max(1, Math.min(16, (v / 100) * 16))
        const ageOpacity = 0.25 + 0.75 * (i / (HIST_BARS - 1))
        return (
          <span
            key={i}
            className="block w-[2px] rounded-[1px]"
            style={{
              height: `${h}px`,
              backgroundColor: v === null ? "rgba(113, 113, 122, 0.2)" : stroke,
              opacity: v === null ? 0.3 : ageOpacity,
            }}
          />
        )
      })}
    </div>
  )
}

function Panel({
  channel,
  values,
  primary,
  detail,
  max,
  warn,
}: {
  channel: Channel
  values: number[]
  primary: string
  detail: string
  max: number
  warn: boolean
}) {
  const ch = CHANNELS[channel]
  const stroke = warn ? WARN.stroke : ch.stroke
  const glow = warn ? WARN.glow : ch.glow
  const W = 260
  const H = 56
  const line = sparklinePath(values, W, H, max)
  const area = sparklinePath(values, W, H, max, true)
  const last = values[values.length - 1]
  const lastX = values.length > 0 ? ((HISTORY - 1) * W) / (HISTORY - 1) : 0
  const lastY =
    last != null
      ? H - (Math.min(last, max) / max) * (H - 2) - 1
      : H

  return (
    <div className="relative bg-zinc-950/60 px-3 pb-2.5 pt-2">
      {/* corner ticks */}
      <CornerTicks color={warn ? "rgba(251, 113, 133, 0.55)" : "rgba(161, 161, 170, 0.35)"} />

      {/* header row */}
      <div className="relative z-10 flex items-baseline justify-between">
        <span
          className="font-mono text-[10px] uppercase tracking-[0.22em]"
          style={{ color: stroke }}
        >
          {ch.label}
        </span>
        <span
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600"
        >
          / {max === 100 ? "100%" : max.toFixed(0)}
        </span>
      </div>

      {/* big number */}
      <div
        className="relative z-10 mt-0.5 font-mono text-[26px] font-medium leading-none tabular-nums"
        style={{
          color: warn ? WARN.stroke : "#e4e4e7",
          textShadow: warn ? `0 0 14px ${glow}` : undefined,
        }}
      >
        {primary}
      </div>

      {/* sparkline */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="mt-1.5 h-[46px] w-full"
        aria-hidden
      >
        <defs>
          <linearGradient id={`grad-${channel}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* grid */}
        <line x1="0" x2={W} y1={H * 0.25} y2={H * 0.25} stroke="rgba(82,82,91,0.18)" strokeDasharray="2 3" />
        <line x1="0" x2={W} y1={H * 0.5}  y2={H * 0.5}  stroke="rgba(82,82,91,0.25)" strokeDasharray="2 3" />
        <line x1="0" x2={W} y1={H * 0.75} y2={H * 0.75} stroke="rgba(82,82,91,0.18)" strokeDasharray="2 3" />
        {area && <path d={area} fill={`url(#grad-${channel})`} />}
        {line && (
          <path
            d={line}
            fill="none"
            stroke={stroke}
            strokeWidth={1.25}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {last != null && (
          <circle
            cx={lastX}
            cy={lastY}
            r={1.8}
            fill={stroke}
            style={{ filter: `drop-shadow(0 0 3px ${glow})` }}
          />
        )}
      </svg>

      {/* detail */}
      <div
        className="relative z-10 mt-1 truncate font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500"
        title={detail}
      >
        {detail}
      </div>
    </div>
  )
}

function CornerTicks({ color }: { color: string }) {
  const size = 8
  const tick = 1
  const common: React.CSSProperties = {
    position: "absolute",
    width: size,
    height: size,
    pointerEvents: "none",
  }
  return (
    <>
      <span
        aria-hidden
        style={{
          ...common,
          top: 0,
          left: 0,
          borderTop: `${tick}px solid ${color}`,
          borderLeft: `${tick}px solid ${color}`,
        }}
      />
      <span
        aria-hidden
        style={{
          ...common,
          top: 0,
          right: 0,
          borderTop: `${tick}px solid ${color}`,
          borderRight: `${tick}px solid ${color}`,
        }}
      />
      <span
        aria-hidden
        style={{
          ...common,
          bottom: 0,
          left: 0,
          borderBottom: `${tick}px solid ${color}`,
          borderLeft: `${tick}px solid ${color}`,
        }}
      />
      <span
        aria-hidden
        style={{
          ...common,
          bottom: 0,
          right: 0,
          borderBottom: `${tick}px solid ${color}`,
          borderRight: `${tick}px solid ${color}`,
        }}
      />
    </>
  )
}
