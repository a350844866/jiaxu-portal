import { NextResponse } from "next/server"
import { readPmPaperSnapshot } from "@/lib/pm-paper-reader"

export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * pm-paper (Polymarket 模拟盘) dashboard snapshot. Read-only local fs (no
 * external requests). No explicit session guard here — same treatment as
 * /api/token/live: the global proxy.ts middleware already gates every
 * non-public path behind the portal login, so this route isn't added to
 * PUBLIC_PATHS and relies on that upstream check.
 */
export async function GET() {
  try {
    const snapshot = await readPmPaperSnapshot()
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } })
  } catch (err) {
    console.error("[api/pm-paper]", err)
    return NextResponse.json(
      { ok: false, error: "pm-paper 状态读取失败" },
      { status: 503 },
    )
  }
}
