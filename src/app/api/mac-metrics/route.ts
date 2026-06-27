/**
 * GET /api/mac-metrics
 *
 * 返回 mac-mini-collector 最新一次 tick + 30 样本历史 + collector 健康指标。
 *
 * Auth: middleware (proxy.ts) 已处理 — 全站统一要 portal 会话 JWT(无内网免登录)。
 * Detail filter (P0-5): 默认不返回完整 args (cmdline), 带 ?detail=1 才返回。
 *
 * 详见 docs/superpowers/specs/2026-05-16-mac-mini-monitoring-design.md §4.2
 */
import { NextRequest, NextResponse } from "next/server"
import {
  getLatest,
  getHistory,
  getCollectorHealth,
  getActiveAlarms,
  type MacMetricsSample,
} from "@/lib/mac-mini-collector"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const showDetail = request.nextUrl.searchParams.get("detail") === "1"
  const latest = getLatest()
  const history = getHistory(30)
  const collector = getCollectorHealth()

  if (!latest) {
    // collector 还没采到第一个 sample (启动初期 / warmup)
    return NextResponse.json(
      {
        ts: null,
        sample_age_ms: null,
        ping_macmini: null,
        ping_router: null,
        ssh_ok: null,
        mac_uptime_sec: null,
        ncpu: null,
        load: null,
        top_proc: null,
        history: { mdev: [], load1: [] },
        alarms_active: [],
        collector,
      },
      { status: 200 },
    )
  }

  const sampleAgeMs = Date.now() - new Date(latest.ts).getTime()
  // 默认 top_proc 不返回 args (敏感, 避免无意泄漏到未登录态)
  const safeTopProc = latest.top_proc
    ? latest.top_proc.map((p) => ({
        pid: p.pid,
        pcpu: p.pcpu,
        pmem: p.pmem,
        comm: p.comm,
        ...(showDetail ? { args: p.args } : {}),
      }))
    : null

  return NextResponse.json(
    {
      ts: latest.ts,
      sample_age_ms: sampleAgeMs,
      ping_macmini: latest.ping_macmini,
      ping_router: latest.ping_router,
      ssh_ok: latest.ssh_ok,
      ssh_error: showDetail ? latest.ssh_error : null,
      mac_uptime_sec: latest.mac_uptime_sec,
      ncpu: latest.ncpu,
      load: latest.load,
      top_proc: safeTopProc,
      history: extractHistorySeries(history),
      alarms_active: getActiveAlarms(),
      collector,
    },
    { status: 200 },
  )
}

function extractHistorySeries(history: MacMetricsSample[]): { mdev: (number | null)[]; load1: (number | null)[] } {
  return {
    mdev: history.map((s) => s.ping_macmini.mdev),
    load1: history.map((s) => s.load?.["1"] ?? null),
  }
}
