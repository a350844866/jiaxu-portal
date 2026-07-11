import { NextResponse } from "next/server"
import { readPmScalpRealSnapshot } from "@/lib/pm-scalp-real-reader"

export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * pm-scalp 实盘（recon 真金账本）dashboard snapshot. Read-only local fs
 * (白名单三文件, 不触碰凭证). 鉴权同 /api/pm-scalp: 全局 proxy.ts 中间件
 * 把所有非公开路径挡在 portal 登录之后（部署后需 curl 实测 401/302,
 * 见 spec 安全节 — 不能只信注释）。
 */
export async function GET() {
  try {
    const snapshot = await readPmScalpRealSnapshot()
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } })
  } catch (err) {
    console.error("[api/pm-scalp/real]", err)
    return NextResponse.json(
      { ok: false, error: "pm-scalp 实盘状态读取失败" },
      { status: 503 },
    )
  }
}
