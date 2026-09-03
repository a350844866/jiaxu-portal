import { NextResponse } from "next/server"
import { getRateLimitUsage } from "@/lib/usage-db"
import { fetchClaudeQuota } from "@/lib/claude-quota"
import { officialWeeklyStartMs } from "@/lib/claude-quota-pure"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  try {
    // 先读官方配额帧(1.4KB 文件, 永不 throw), 拿到官方 7d 窗起点后再查 MySQL —— 这样卡片上
    // "本周 $"(标价折算)与"本周 %"(官方)说的是同一个窗口, 不再各自锚定(usage-db 的
    // weeklyResetUtc 是硬编码周日 03:00Z, 与官方目前吻合但官方是按账号滚动的). 帧缺失时回退硬编码.
    const now = Date.now()
    const claude_quota = await fetchClaudeQuota(now)
    const weeklyStart = officialWeeklyStartMs(claude_quota, now)
    const data = await getRateLimitUsage(weeklyStart === null ? undefined : new Date(weeklyStart))
    return NextResponse.json({ ...data, claude_quota }, {
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
