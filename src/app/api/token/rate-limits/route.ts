import { NextResponse } from "next/server"
import { getRateLimitUsage } from "@/lib/usage-db"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  try {
    const data = await getRateLimitUsage()
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (err) {
    console.error("[api/token/rate-limits]", err)
    return NextResponse.json(
      { error: "usage_db_unavailable", detail: String(err) },
      { status: 503 },
    )
  }
}
