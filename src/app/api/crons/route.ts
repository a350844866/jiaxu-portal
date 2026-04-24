import { NextResponse } from "next/server"
import { promises as fs } from "node:fs"
import path from "node:path"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const STATE_DIR = process.env.PORTAL_STATE_DIR || "/data/portal-state"
const SNAPSHOT_PATH = path.join(STATE_DIR, "cron-snapshot.json")
const STALE_MS = 15 * 60 * 1000

export async function GET() {
  try {
    const stat = await fs.stat(SNAPSHOT_PATH)
    const raw = await fs.readFile(SNAPSHOT_PATH, "utf8")
    const data = JSON.parse(raw)
    const ageMs = Date.now() - stat.mtimeMs
    return NextResponse.json(
      {
        generated_at: data.generated_at,
        age_seconds: Math.round(ageMs / 1000),
        stale: ageMs > STALE_MS,
        jobs: data.jobs ?? [],
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    return NextResponse.json(
      {
        generated_at: null,
        age_seconds: null,
        stale: true,
        error: code === "ENOENT" ? "snapshot missing" : String(e),
        jobs: [],
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    )
  }
}
