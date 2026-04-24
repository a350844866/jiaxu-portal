import { NextResponse } from "next/server"
import { promises as fs } from "node:fs"
import { statfs } from "node:fs/promises"
import os from "node:os"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DISK_PATH = process.env.METRICS_DISK_PATH || "/"

async function readCpuTimes() {
  const data = await fs.readFile("/proc/stat", "utf8")
  const line = data.split("\n")[0]
  const parts = line
    .trim()
    .split(/\s+/)
    .slice(1)
    .map((x) => parseInt(x, 10) || 0)
  const idle = (parts[3] ?? 0) + (parts[4] ?? 0)
  const total = parts.reduce((a, b) => a + b, 0)
  return { idle, total }
}

async function cpuPercent(): Promise<number> {
  const a = await readCpuTimes()
  await new Promise((r) => setTimeout(r, 120))
  const b = await readCpuTimes()
  const idleDelta = b.idle - a.idle
  const totalDelta = b.total - a.total
  if (totalDelta <= 0) return 0
  return Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100))
}

async function memInfo() {
  const raw = await fs.readFile("/proc/meminfo", "utf8")
  const lookup: Record<string, number> = {}
  for (const line of raw.split("\n")) {
    const m = line.match(/^(\w+):\s+(\d+)\s+kB$/)
    if (m) lookup[m[1]] = parseInt(m[2], 10) * 1024
  }
  const total = lookup.MemTotal ?? 0
  const available = lookup.MemAvailable ?? lookup.MemFree ?? 0
  const used = Math.max(0, total - available)
  return { total, used, percent: total > 0 ? (used / total) * 100 : 0 }
}

async function diskInfo(path: string) {
  const s = await statfs(path)
  const total = Number(s.blocks) * s.bsize
  const free = Number(s.bfree) * s.bsize
  const used = total - free
  return { total, used, percent: total > 0 ? (used / total) * 100 : 0 }
}

async function loadAvg(): Promise<[number, number, number]> {
  try {
    const raw = await fs.readFile("/proc/loadavg", "utf8")
    const [a, b, c] = raw.trim().split(/\s+/).slice(0, 3).map(parseFloat)
    return [a, b, c]
  } catch {
    return os.loadavg() as [number, number, number]
  }
}

async function uptime(): Promise<number> {
  try {
    const raw = await fs.readFile("/proc/uptime", "utf8")
    return parseFloat(raw.trim().split(/\s+/)[0])
  } catch {
    return os.uptime()
  }
}

export async function GET() {
  try {
    const [cpu, mem, disk, load, up] = await Promise.all([
      cpuPercent(),
      memInfo(),
      diskInfo(DISK_PATH).catch(() => ({ total: 0, used: 0, percent: 0 })),
      loadAvg(),
      uptime(),
    ])
    return NextResponse.json(
      {
        ts: new Date().toISOString(),
        cpu: { percent: cpu, cores: os.cpus().length },
        mem,
        disk: { ...disk, path: DISK_PATH },
        load: { "1": load[0], "5": load[1], "15": load[2] },
        uptime: up,
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (e) {
    return NextResponse.json(
      { error: String(e) },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    )
  }
}
