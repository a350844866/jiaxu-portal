import { promises as fs } from "node:fs"
import path from "node:path"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

// Lightweight liveness for the ai-chain dashboard(与 /api/serenity/health 同模式):
// 只 stat chain.json,不读不解析。quotes.json 缺失不算 down(页面本身可降级)。
// 200 = vault 挂载可读且 chain.json 存在。PUBLIC_PATHS 放行,仅返回 {ok}。
export async function GET() {
  try {
    const vaultDir = process.env.VAULT_DIR || "/data/vault"
    await fs.stat(path.join(vaultDir, "wiki", "concepts", "ai-chain.json"))
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.warn("[ai-chain] health check failed:", e instanceof Error ? e.message : String(e))
    return NextResponse.json({ ok: false }, { status: 503 })
  }
}
