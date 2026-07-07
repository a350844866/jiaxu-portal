import { NextResponse } from "next/server"
import { readPmPaperDetail } from "@/lib/pm-paper-detail-reader"

export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * Full pm-paper detail payload for the /pm-paper dashboard page (open orders
 * replay, positions, latest-per-market predictions, settlements, calibration).
 * Read-only local fs, no external requests. Same auth treatment as
 * /api/pm-paper and /api/token/live — not added to PUBLIC_PATHS, relies on
 * the global proxy.ts session gate.
 *
 * The /pm-paper page itself does NOT call this route over HTTP — it imports
 * readPmPaperDetail() directly server-side (same convention as /serenity and
 * /ai-chain). This endpoint exists for programmatic access / future
 * client-side polling and is covered by its own tests.
 */
export async function GET() {
  try {
    const detail = await readPmPaperDetail()
    return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } })
  } catch (err) {
    console.error("[api/pm-paper/detail]", err)
    return NextResponse.json(
      { ok: false, error: "pm-paper 详情读取失败" },
      { status: 503 },
    )
  }
}
