import { promises as fs } from "node:fs"
import path from "node:path"
import { parseChain, parseQuotes, type Chain, type Quotes } from "@/lib/ai-chain-pure"

// Re-export pure types/helpers,使用方 server component 只 import 本模块即可。
export {
  parseChain,
  parseQuotes,
  fmtPct,
  fmtPrice,
  fmtMcap,
  CP_WEIGHT,
} from "@/lib/ai-chain-pure"
export type {
  Chain,
  ChainStock,
  ChainSegment,
  ChainSignal,
  ChainDebate,
  CpLevel,
  SignalType,
  SignalSource,
  Quote,
  Quotes,
} from "@/lib/ai-chain-pure"

// chain.json 活在 vault(经 Nextcloud 同步到家服,容器内 VAULT_DIR 只读挂载),
// 与 todo-reader 同一挂载;quotes.json 由家服 cron(yfinance)写在 AI_CHAIN_DATA_DIR。
// 调用时解析(非模块加载时),测试可覆盖 env。
function chainPath(): string {
  return path.join(process.env.VAULT_DIR || "/data/vault", "wiki", "concepts", "ai-chain.json")
}

function quotesPath(): string {
  return path.join(process.env.AI_CHAIN_DATA_DIR || "/data/ai-chain", "quotes.json")
}

export async function readChain(): Promise<
  { ok: true; chain: Chain; ageSeconds: number } | { ok: false; error: string }
> {
  try {
    const p = chainPath()
    const stat = await fs.stat(p)
    const raw = await fs.readFile(p, "utf-8")
    return { ok: true, chain: parseChain(raw), ageSeconds: Math.round((Date.now() - stat.mtimeMs) / 1000) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function readQuotes(): Promise<
  { ok: true; quotes: Quotes; ageSeconds: number } | { ok: false; error: string }
> {
  try {
    const p = quotesPath()
    const stat = await fs.stat(p)
    const raw = await fs.readFile(p, "utf-8")
    return { ok: true, quotes: parseQuotes(raw), ageSeconds: Math.round((Date.now() - stat.mtimeMs) / 1000) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
