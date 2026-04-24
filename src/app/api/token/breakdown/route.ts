import { NextRequest, NextResponse } from "next/server"
import { getUsageBreakdown } from "@/lib/usage-db"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(req: NextRequest) {
  const hoursParam = req.nextUrl.searchParams.get("hours")
  const hours = Math.min(Math.max(Number(hoursParam || 24) || 24, 1), 24 * 31)
  try {
    const data = await getUsageBreakdown(hours)
    return NextResponse.json(
      { hours, points: data },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (err) {
    console.error("[api/token/breakdown]", err)
    return NextResponse.json(
      { error: "usage_db_unavailable", detail: String(err) },
      { status: 503 }
    )
  }
}
