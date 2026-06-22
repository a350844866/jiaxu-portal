import { NextResponse } from "next/server"
import { queryLogs, VlogsError } from "@/lib/vlogs"
import { parseLogsParams } from "./params"
import { isAuthed } from "./guard"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }
  let params
  try {
    params = parseLogsParams(new URL(req.url).searchParams)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
  try {
    const lines = await queryLogs(params)
    return NextResponse.json({ lines })
  } catch (e) {
    const kind = e instanceof VlogsError ? e.kind : "unknown"
    console.error(`[api/logs] vlogs failed kind=${kind}:`, e)
    return NextResponse.json({ error: "日志源暂不可达" }, { status: 502 })
  }
}
