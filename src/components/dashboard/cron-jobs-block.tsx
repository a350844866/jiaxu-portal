"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronDown } from "lucide-react"
import cronstrue from "cronstrue/i18n"
import { cn } from "@/lib/utils"

type CronJob = {
  id: string
  source: string
  name: string
  schedule_raw: string
  command: string
  enabled: boolean
}

type Snapshot = {
  generated_at: string | null
  age_seconds: number | null
  stale: boolean
  error?: string
  jobs: CronJob[]
}

const STORAGE_KEY = "jiaxu.crons.expanded"

// Approximate frequency in seconds for sorting (smaller = more frequent).
function intervalSeconds(schedule: string): number {
  // systemd "@every Xs/min/h"
  const everyMatch = schedule.match(/^@every\s+(\d+)\s*(s|sec|min|h|hour)/i)
  if (everyMatch) {
    const n = parseInt(everyMatch[1], 10)
    const unit = everyMatch[2].toLowerCase()
    if (unit.startsWith("s")) return n
    if (unit.startsWith("min")) return n * 60
    if (unit.startsWith("h")) return n * 3600
  }
  // systemd OnCalendar "*-*-* HH:MM:SS" → daily
  if (/^\*-\*-\*\s+\d/.test(schedule)) return 86400
  // 5-field cron heuristics (good enough for sort order)
  const f = schedule.split(/\s+/)
  if (f.length !== 5) return 999999
  const [min, hr, dom, mon, dow] = f
  if (min === "*" && hr === "*") return 60
  const stepMin = min.match(/^\*\/(\d+)$/)
  if (stepMin && hr === "*") return parseInt(stepMin[1], 10) * 60
  const listMin = min.match(/^[\d,]+$/)
  if (listMin && hr === "*") {
    const count = min.split(",").length
    return Math.round(3600 / count)
  }
  const rangeStep = min.match(/^\d+-\d+\/(\d+)$/)
  if (rangeStep && hr === "*") return parseInt(rangeStep[1], 10) * 60
  const stepHr = hr.match(/^\*\/(\d+)$/)
  if (stepHr) return parseInt(stepHr[1], 10) * 3600
  if (dom === "*" && mon === "*" && dow === "*") return 86400
  return 604800
}

function describeSchedule(schedule: string): string {
  // systemd "@every Xmin"
  const everyMatch = schedule.match(/^@every\s+(\d+)\s*(s|sec|min|h|hour)/i)
  if (everyMatch) {
    const n = parseInt(everyMatch[1], 10)
    const unit = everyMatch[2].toLowerCase()
    if (unit.startsWith("s")) return `每 ${n} 秒`
    if (unit.startsWith("min")) return n === 1 ? "每分钟" : `每 ${n} 分钟`
    if (unit.startsWith("h")) return n === 1 ? "每小时" : `每 ${n} 小时`
  }
  // systemd OnCalendar "*-*-* HH:MM:SS"
  const calMatch = schedule.match(/^\*-\*-\*\s+(\d{2}):(\d{2})/)
  if (calMatch) return `每天 ${calMatch[1]}:${calMatch[2]}`
  // 5-field cron → cronstrue
  const fields = schedule.split(/\s+/)
  if (fields.length === 5) {
    const [, , dom, mon, dow] = fields
    const isDaily = dom === "*" && mon === "*" && dow === "*"
    try {
      let s = cronstrue.toString(schedule, {
        locale: "zh_CN",
        use24HourTimeFormat: true,
      })
      s = s
        .replace(/^在\s*/, "")
        .replace(/^每\s*1\s*分钟$/, "每分钟")
        .replace(/^每\s*1\s*小时$/, "每小时")
        .replace(/^整点,\s*/, "")
      if (isDaily && /^\d{1,2}:\d{2}/.test(s)) {
        s = "每天 " + s
      }
      return s
    } catch {
      return schedule
    }
  }
  return schedule
}

function shortCommand(command: string): string {
  // Strip "sleep N && " prefix
  const noSleep = command.replace(/^sleep\s+\d+\s+&&\s+/, "")
  // Strip env-var prefixes (FOO=bar BAZ=qux ...)
  const noEnv = noSleep.replace(/^(?:[A-Z_][A-Z0-9_]*=\S+\s+)+/, "")
  // Strip trailing redirections (>> /var/log/... 2>&1)
  return noEnv.replace(/\s+(>>|>|2>&1|2>).*$/, "")
}

export function CronJobsBlock() {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY)
      if (v === "1") setExpanded(true)
    } catch {}
    setHydrated(true)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch("/api/crons", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: Snapshot) => {
        if (!cancelled) setSnap(j)
      })
      .catch((e) => {
        if (!cancelled) setErr(String(e))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = () => {
    setExpanded((v) => {
      try {
        localStorage.setItem(STORAGE_KEY, !v ? "1" : "0")
      } catch {}
      return !v
    })
  }

  const sortedJobs = useMemo(() => {
    if (!snap?.jobs) return []
    return [...snap.jobs].sort((a, b) => {
      // enabled first
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
      // then by interval (frequent first)
      return intervalSeconds(a.schedule_raw) - intervalSeconds(b.schedule_raw)
    })
  }, [snap])

  const enabledCount = sortedJobs.filter((j) => j.enabled).length
  const disabledCount = sortedJobs.length - enabledCount

  const counter =
    snap === null
      ? "loading"
      : disabledCount > 0
      ? `${enabledCount} 个 · ${disabledCount} 已禁用`
      : `${enabledCount} 个`

  return (
    <section className="mt-3 rounded-lg border border-zinc-800/80 bg-zinc-950/40 ring-1 ring-foreground/10">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-zinc-900/40"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            CRON
          </span>
          <span className="text-sm font-medium text-zinc-200">定时任务</span>
          <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
            {counter}
          </span>
          {snap?.stale && (
            <span
              className="h-1.5 w-1.5 rounded-full bg-rose-400 shadow-[0_0_6px_rgba(251,113,133,0.6)]"
              title={`快照过期 (age ${snap.age_seconds ?? "?"}s)`}
            />
          )}
        </div>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-zinc-500 transition-transform duration-200",
            expanded && "rotate-180"
          )}
        />
      </button>

      {hydrated && (
        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-300 ease-out",
            expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="border-t border-zinc-800/80 px-2 py-2">
              {err && (
                <div className="px-2 py-2 font-mono text-[11px] text-rose-400/80">
                  failed to load · {err}
                </div>
              )}
              {snap?.error && !err && (
                <div className="px-2 py-2 font-mono text-[11px] text-amber-400/80">
                  {snap.error}
                </div>
              )}
              <ul className="divide-y divide-zinc-900/60">
                {sortedJobs.map((job) => {
                  const human = describeSchedule(job.schedule_raw)
                  const cmd = shortCommand(job.command)
                  return (
                    <li
                      key={job.id}
                      className={cn(
                        "grid grid-cols-[14px_minmax(0,2.4fr)_minmax(0,1.2fr)_minmax(0,3fr)] items-center gap-3 px-2 py-1.5",
                        !job.enabled && "opacity-40"
                      )}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          job.enabled
                            ? "bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.6)]"
                            : "bg-zinc-600"
                        )}
                        aria-hidden
                      />
                      <span
                        className={cn(
                          "truncate text-[12.5px] text-zinc-200",
                          !job.enabled && "line-through"
                        )}
                        title={job.name}
                      >
                        {job.name}
                      </span>
                      <span
                        className="truncate font-mono text-[11px] tabular-nums text-amber-300/90"
                        title={job.schedule_raw}
                      >
                        {human}
                      </span>
                      <span
                        className="truncate font-mono text-[11px] text-zinc-500"
                        title={job.command}
                      >
                        {cmd}
                      </span>
                    </li>
                  )
                })}
                {sortedJobs.length === 0 && !err && (
                  <li className="px-2 py-3 text-center font-mono text-[11px] text-zinc-600">
                    {snap === null ? "加载中…" : "(无任务)"}
                  </li>
                )}
              </ul>
              {snap?.generated_at && (
                <div className="px-2 pt-2 text-right font-mono text-[10px] text-zinc-600">
                  快照 {new Date(snap.generated_at).toLocaleString("zh-CN", { hour12: false })}
                  {snap.age_seconds !== null && ` · ${snap.age_seconds}s ago`}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
