import { NextResponse } from "next/server"
import { readTradeMaxCard } from "@/lib/trademax-reader"

export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * trademax-observer home-card snapshot. Read-only local fs, no external
 * requests. No explicit session guard — the global proxy.ts middleware gates
 * every non-public path, same treatment as /api/pm-paper.
 */
export async function GET() {
  try {
    const data = await readTradeMaxCard()
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } })
  } catch (err) {
    console.error("[api/trademax]", err)
    return NextResponse.json(
      { ok: false, error: "trademax 观察栈状态读取失败" },
      { status: 503 },
    )
  }
}
