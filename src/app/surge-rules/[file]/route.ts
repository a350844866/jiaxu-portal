import { NextRequest, NextResponse } from "next/server"
import { readFile } from "fs/promises"
import { join } from "path"

export const dynamic = "force-dynamic"

const RULES_DIR = process.env.SURGE_RULES_DIR || "./data/surge-rules"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ file: string }> }
) {
  try {
    const { file } = await params
    const safe = file.replace(/[^a-zA-Z0-9._-]/g, "")
    if (!safe.endsWith(".list")) {
      return new NextResponse("Not found", { status: 404 })
    }
    const content = await readFile(join(RULES_DIR, safe), "utf-8")
    return new NextResponse(content, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  } catch {
    return new NextResponse("Not found", { status: 404 })
  }
}
