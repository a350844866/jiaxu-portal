import { NextRequest, NextResponse } from "next/server"
import { promises as fs } from "node:fs"
import path from "node:path"

export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * 模拟盘单窗回放数据（策略板下钻第二级）。读 1Hz 磁带
 * /data/pm-scalp/data/window-<wts>.jsonl，产出与 MiniChart（btc-v1 范式）
 * 兼容的 {strike, btc:[{s,dev}]} + 该变体在此窗的入场标记（trades.jsonl 行）。
 *
 * w 参数进入文件名 → 严格三重校验：10 位纯数字正则 / 整除 300（窗口边界）/
 * 合理 epoch 区间。校验后 String(int) 重构造，杜绝路径注入。
 * 鉴权同 /api/pm-scalp：全局 proxy.ts 中间件门。
 */

const VARIANT_RE = /^[A-Z0-9][A-Z0-9-]{1,11}$/
const W_RE = /^\d{10}$/
// strike 镜像 ticksim/tape.py::strike：首个 s≤5 且 cl 合法的行;
// 界值同 tape.py::CL_VALID=(1_000, 10_000_000)（review minor #3 对齐）
const CL_MIN = 1_000
const CL_MAX = 10_000_000

function dir(): string {
  return process.env.PM_SCALP_DIR ?? "/data/pm-scalp"
}

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

export async function GET(req: NextRequest) {
  const wRaw = req.nextUrl.searchParams.get("w") ?? ""
  const v = req.nextUrl.searchParams.get("v") ?? ""
  if (!W_RE.test(wRaw) || !VARIANT_RE.test(v)) {
    return NextResponse.json({ ok: false, error: "bad params" }, { status: 400 })
  }
  const w = Number.parseInt(wRaw, 10)
  if (w % 300 !== 0 || w < 1_700_000_000 || w > 2_000_000_000) {
    return NextResponse.json({ ok: false, error: "bad window" }, { status: 400 })
  }

  let tapeText: string
  try {
    tapeText = await fs.readFile(
      path.join(dir(), "data", `window-${String(w)}.jsonl`), "utf8")
  } catch {
    return NextResponse.json(
      { ok: false, error: "该窗口 1Hz 磁带不存在(可能已超保留期)" },
      { status: 404 },
    )
  }

  try {
    let strike: number | null = null
    const btc: { s: number; dev: number }[] = []
    const raw: { s: number; cl: number }[] = []
    for (const line of tapeText.split("\n")) {
      if (!line) continue
      let o: Record<string, unknown>
      try {
        o = JSON.parse(line)
      } catch {
        continue
      }
      if (o.meta) continue
      const s = num(o.s)
      const cl = num(o.cl)
      if (s == null || cl == null || s < 0 || s > 300) continue
      if (cl <= CL_MIN || cl >= CL_MAX) continue
      raw.push({ s, cl })
      if (strike == null && s <= 5) strike = cl
    }
    if (strike == null || raw.length < 4) {
      return NextResponse.json(
        { ok: false, error: "磁带无有效开盘价/轨迹太薄" }, { status: 422 })
    }
    for (const r of raw) btc.push({ s: r.s, dev: r.cl - strike })

    // 该变体在此窗的入场标记（无则 sEntry=null 纯轨迹展示）
    let sEntry: number | null = null
    let side: "Up" | "Down" = "Up"
    let limit = 0
    let won: boolean | null = null
    let pnl = 0
    let filled = false
    let settle: string | null = null
    let found = false
    try {
      const ledger = await fs.readFile(
        path.join(dir(), "paper", "trades.jsonl"), "utf8")
      for (const line of ledger.split("\n")) {
        if (!line.includes(`"w":${w}`) || !line.includes(`"v":"${v}"`)) continue
        let o: Record<string, unknown>
        try {
          o = JSON.parse(line)
        } catch {
          continue
        }
        if (o.type !== "entry" || o.v !== v || o.w !== w) continue
        sEntry = num(o.s)
        side = o.side_up === true ? "Up" : "Down"
        limit = num(o.limit) ?? 0
        won = typeof o.won === "boolean" ? o.won : null
        pnl = num(o.net) ?? 0
        filled = o.settle === "settled"
        settle = typeof o.settle === "string" ? o.settle : null
        found = true
        break
      }
    } catch {
      // 账本读取失败不阻塞轨迹展示
    }

    return NextResponse.json(
      {
        ok: true, w, windowLabel: windowLabel(w), strike,
        side, sEntry, limit, won, pnl, filled, settle,
        entryFound: found, btc,
      },
      { headers: { "Cache-Control": "no-store" } },
    )
  } catch (err) {
    console.error("[api/pm-scalp/paper-window]", err)
    return NextResponse.json(
      { ok: false, error: "磁带解析失败" }, { status: 503 })
  }
}
