import { NextResponse } from "next/server"
import { readPmScalpSnapshot } from "@/lib/pm-scalp-reader"

export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * pm-scalp (Polymarket BTC 5-min 微结构实验) dashboard snapshot. Read-only
 * local fs (no external requests). No explicit session guard here — same
 * treatment as /api/pm-paper: the global proxy.ts middleware already gates
 * every non-public path behind the portal login.
 */
export async function GET() {
  try {
    const snapshot = await readPmScalpSnapshot()
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } })
  } catch (err) {
    console.error("[api/pm-scalp]", err)
    return NextResponse.json(
      { ok: false, error: "pm-scalp 状态读取失败" },
      { status: 503 },
    )
  }
}
