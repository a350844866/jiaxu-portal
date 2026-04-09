import { NextRequest, NextResponse } from "next/server"
import { readFile, writeFile, readdir } from "fs/promises"
import { join } from "path"

export const dynamic = "force-dynamic"

const RULES_DIR = process.env.SURGE_RULES_DIR || "./data/surge-rules"

export async function GET(request: NextRequest) {
  const file = request.nextUrl.searchParams.get("file")
  try {
    if (file) {
      // Read specific file
      const safe = file.replace(/[^a-zA-Z0-9._-]/g, "")
      const content = await readFile(join(RULES_DIR, safe), "utf-8")
      return NextResponse.json({ file: safe, content })
    }
    // List all .list files
    const entries = await readdir(RULES_DIR)
    const files = entries.filter((f) => f.endsWith(".list"))
    return NextResponse.json({ files })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { file, content } = body as { file: string; content: string }
    if (!file || typeof content !== "string") {
      return NextResponse.json({ error: "file and content required" }, { status: 400 })
    }
    const safe = file.replace(/[^a-zA-Z0-9._-]/g, "")
    if (!safe.endsWith(".list")) {
      return NextResponse.json({ error: "Only .list files allowed" }, { status: 400 })
    }
    await writeFile(join(RULES_DIR, safe), content, "utf-8")
    return NextResponse.json({ ok: true, file: safe })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    )
  }
}
