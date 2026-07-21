import { NextRequest, NextResponse } from "next/server"
import { promises as fs } from "node:fs"
import path from "node:path"

export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * 模拟盘单变体成交记录（策略板下钻第一级）。只读
 * /data/pm-scalp/paper/trades.jsonl（runner 账本，type=entry 行），按变体过滤
 * 返回最近 N 笔（新→旧）。鉴权同 /api/pm-scalp：全局 proxy.ts 中间件门。
 * v 参数白名单正则校验——绝不进文件路径（文件路径是常量），只做字段等值比较。
 */

const VARIANT_RE = /^[A-Z0-9][A-Z0-9-]{1,11}$/
const MAX_ROWS = 60

function dir(): string {
  return process.env.PM_SCALP_DIR ?? "/data/pm-scalp"
}

/** epoch 秒 → "MM-DD HH:mm"（+08 展示,与既有 reader 同式） */
function windowLabel(w: number): string {
  const d = new Date((w + 8 * 3600) * 1000)
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(d.getUTCDate()).padStart(2, "0")
  const hh = String(d.getUTCHours()).padStart(2, "0")
  const mi = String(d.getUTCMinutes()).padStart(2, "0")
  return `${mm}-${dd} ${hh}:${mi}`
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

export interface PaperTradeRow {
  w: number
  windowLabel: string
  s: number | null
  sideUp: boolean
  limit: number
  settle: string
  won: boolean | null
  net: number | null
}

export async function GET(req: NextRequest) {
  const v = req.nextUrl.searchParams.get("v") ?? ""
  if (!VARIANT_RE.test(v)) {
    return NextResponse.json({ ok: false, error: "bad variant" }, { status: 400 })
  }
  try {
    const text = await fs.readFile(
      path.join(dir(), "paper", "trades.jsonl"), "utf8")
    const rows: PaperTradeRow[] = []
    for (const line of text.split("\n")) {
      if (!line) continue
      let o: Record<string, unknown>
      try {
        o = JSON.parse(line)
      } catch {
        continue
      }
      if (o.type !== "entry" || o.v !== v) continue
      const w = num(o.w)
      const limit = num(o.limit)
      if (w == null || limit == null) continue
      rows.push({
        w,
        windowLabel: windowLabel(w),
        s: num(o.s),
        sideUp: o.side_up === true,
        limit,
        settle: typeof o.settle === "string" ? o.settle : "unknown",
        won: typeof o.won === "boolean" ? o.won : null,
        net: num(o.net),
      })
    }
    rows.reverse() // 账本按时间追加 → 新在前
    return NextResponse.json(
      { ok: true, v, rows: rows.slice(0, MAX_ROWS), total: rows.length },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (err) {
    console.error("[api/pm-scalp/paper-trades]", err)
    return NextResponse.json(
      { ok: false, error: "账本读取失败" }, { status: 503 })
  }
}
