/**
 * GET /api/claude-topics          → 快照 JSON(含 age_seconds / stale)
 * GET /api/claude-topics?format=md → 完整 Markdown 报告原文(text/plain)
 *
 * 数据由宿主 5min timer 写入 /data/portal-state/，本路由只读，见 @/lib/claude-topics。
 */
import { NextResponse } from "next/server"
import { fetchTopicSnapshot, fetchTopicReportMarkdown } from "@/lib/claude-topics"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const format = new URL(req.url).searchParams.get("format")

  if (format === "md") {
    const md = await fetchTopicReportMarkdown()
    if (md == null) {
      return new NextResponse("报告尚未生成(宿主 timer 未跑过?)", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      })
    }
    return new NextResponse(md, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    })
  }

  const r = await fetchTopicSnapshot()
  // 与 /api/crons 一致: 读不到也返回 200 + stale 标记, 让前端渲染"陈旧"而不是崩一整块
  return NextResponse.json(
    r.ok
      ? { ...r.data, age_seconds: r.ageSeconds, stale: r.stale }
      : { error: r.error, age_seconds: r.ageSeconds, stale: true },
    { headers: { "Cache-Control": "no-store" } }
  )
}
