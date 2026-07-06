import { NextResponse } from "next/server"
import { feErrorSummary, VlogsError } from "@/lib/vlogs"
import { isAuthed } from "../guard"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * 前端错误上报(FE_ERROR)24h 聚合摘要。无入参(窗口固定,零注入面);
 * 会话门禁同 /api/logs 家族(生产日志敏感,SECURITY CONTRACT 见 guard.test.ts)。
 */
export async function GET() {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }
  try {
    const summary = await feErrorSummary()
    return NextResponse.json(summary)
  } catch (e) {
    const kind = e instanceof VlogsError ? e.kind : "unknown"
    console.error(`[api/logs/fe-errors] vlogs failed kind=${kind}:`, e)
    return NextResponse.json({ error: "日志源暂不可达" }, { status: 502 })
  }
}
