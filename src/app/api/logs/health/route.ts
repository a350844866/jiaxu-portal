import { NextResponse } from "next/server"
import { healthCounts, VlogsError } from "@/lib/vlogs"
import { allContainers } from "@/config/log-services"
import { parseHealthWindow } from "../params"
import { isAuthed } from "../guard"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }
  let window: string
  try {
    window = parseHealthWindow(new URL(req.url).searchParams)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
  try {
    const counts = await healthCounts(allContainers(), window)
    return NextResponse.json({ window, counts, ts: Date.now() })
  } catch (e) {
    const kind = e instanceof VlogsError ? e.kind : "unknown"
    console.error(`[api/logs/health] vlogs failed kind=${kind}:`, e)
    return NextResponse.json({ error: "日志源暂不可达" }, { status: 502 })
  }
}
