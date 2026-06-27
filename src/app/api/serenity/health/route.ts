import { promises as fs } from "node:fs"
import path from "node:path"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const CORPUS_DIR = process.env.SERENITY_CORPUS_DIR || "/data/x-corpus"

// Lightweight liveness for the Serenity dashboard. Stats the ledger only (no
// 1.3MB corpus read/parse) so the portal health poll stays cheap — unlike
// probing the full /serenity page, which is force-dynamic and re-renders all
// charts + reparses the corpus on every tick. 200 = ledger present & readable.
export async function GET() {
  try {
    await fs.stat(path.join(CORPUS_DIR, "ledger.json"))
    return NextResponse.json({ ok: true })
  } catch (e) {
    // Public liveness endpoint (PUBLIC_PATHS in proxy.ts): the portal's own
    // /api/health aggregator probes it over loopback, so it must be reachable
    // without a session. Body stays generic ({ok:false}) — never echo the
    // corpus filesystem path. Returns only liveness, nothing sensitive.
    console.warn("[serenity] health check failed:", e instanceof Error ? e.message : String(e))
    return NextResponse.json({ ok: false }, { status: 503 })
  }
}
