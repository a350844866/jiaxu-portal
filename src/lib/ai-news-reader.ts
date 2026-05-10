import { promises as fs } from "node:fs"
import path from "node:path"

export type AINewsCompany =
  | "anthropic" | "openai" | "google" | "xai"
  | "meta" | "microsoft" | "apple" | "cohere" | "mistral"
  | "deepseek" | "qwen" | "zhipu" | "doubao" | "minimax"
  | "general"

export type AINewsCategory =
  | "product" | "model_release" | "api" | "research" | "paper"
  | "funding" | "people" | "infra" | "security" | "outage"
  | "pricing" | "controversy" | "policy" | "community"

export interface AINewsEvent {
  cluster_id?: string
  company: AINewsCompany
  category: AINewsCategory
  title: string
  title_zh?: string
  summary?: string
  summary_zh?: string
  importance_score: number
  importance_reason?: string
  urls: string[]
  published_at?: string
  sources?: string[]
  /** True when all sources are HTML-diff (published_at = first-seen, not actual article date). */
  is_first_seen_only?: boolean
}

export interface AINewsDigest {
  date: string
  generated_at: string
  events: AINewsEvent[]
  total_count: number
  by_company: Partial<Record<AINewsCompany, number>>
}

export interface AINewsSnapshot {
  ok: boolean
  error?: string
  ageSeconds: number | null
  digest: AINewsDigest | null
}

export interface AINewsRecent {
  ok: boolean
  error?: string
  digests: AINewsDigest[]
}

const DIGESTS_DIR = process.env.AI_NEWS_DIGESTS_DIR || "/data/ai-news/digests"

const COMPANY_LABELS: Record<AINewsCompany, { label: string; emoji: string; tone: string }> = {
  anthropic:  { label: "Anthropic",  emoji: "🟧", tone: "border-orange-500/30 bg-orange-500/5 text-orange-100" },
  openai:     { label: "OpenAI",     emoji: "⚫", tone: "border-zinc-400/30 bg-zinc-500/5 text-zinc-100" },
  google:     { label: "Google AI",  emoji: "🔵", tone: "border-blue-500/30 bg-blue-500/5 text-blue-100" },
  xai:        { label: "xAI",        emoji: "⚡", tone: "border-violet-500/30 bg-violet-500/5 text-violet-100" },
  meta:       { label: "Meta AI",    emoji: "🔷", tone: "border-sky-500/30 bg-sky-500/5 text-sky-100" },
  microsoft:  { label: "Microsoft",  emoji: "🟦", tone: "border-cyan-500/30 bg-cyan-500/5 text-cyan-100" },
  apple:      { label: "Apple",      emoji: "🍎", tone: "border-zinc-300/30 bg-zinc-300/5 text-zinc-100" },
  cohere:     { label: "Cohere",     emoji: "🟪", tone: "border-fuchsia-500/30 bg-fuchsia-500/5 text-fuchsia-100" },
  mistral:    { label: "Mistral",    emoji: "🟥", tone: "border-rose-500/30 bg-rose-500/5 text-rose-100" },
  deepseek:   { label: "DeepSeek",   emoji: "🟦", tone: "border-indigo-500/30 bg-indigo-500/5 text-indigo-100" },
  qwen:       { label: "通义千问",   emoji: "🟫", tone: "border-amber-500/30 bg-amber-500/5 text-amber-100" },
  zhipu:      { label: "智谱",       emoji: "🟦", tone: "border-teal-500/30 bg-teal-500/5 text-teal-100" },
  doubao:     { label: "豆包",       emoji: "🫘", tone: "border-yellow-500/30 bg-yellow-500/5 text-yellow-100" },
  minimax:    { label: "MiniMax",    emoji: "🔻", tone: "border-pink-500/30 bg-pink-500/5 text-pink-100" },
  general:    { label: "聚合/其它",  emoji: "🌐", tone: "border-zinc-500/30 bg-zinc-500/5 text-zinc-300" },
}

const COMPANY_ORDER: AINewsCompany[] = [
  "anthropic", "openai", "google", "xai",
  "meta", "microsoft", "apple", "cohere", "mistral",
  "deepseek", "qwen", "zhipu", "doubao", "minimax",
  "general",
]

export function companyMeta(c: AINewsCompany) {
  return COMPANY_LABELS[c] ?? COMPANY_LABELS.general
}

export function companyOrder(): AINewsCompany[] {
  return COMPANY_ORDER
}

export async function readToday(): Promise<AINewsSnapshot> {
  const file = path.join(DIGESTS_DIR, "today.json")
  try {
    const stat = await fs.stat(file)
    const raw = await fs.readFile(file, "utf8")
    const digest = JSON.parse(raw) as AINewsDigest
    const ageMs = Date.now() - stat.mtimeMs
    return { ok: true, ageSeconds: Math.round(ageMs / 1000), digest }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    return {
      ok: false,
      ageSeconds: null,
      digest: null,
      error: code === "ENOENT" ? "今日 digest 尚未生成" : String(e),
    }
  }
}

export async function readRecent(days: number = 30): Promise<AINewsRecent> {
  try {
    const entries = await fs.readdir(DIGESTS_DIR)
    const datedFiles = entries
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort()
      .reverse()
      .slice(0, days)
    const digests: AINewsDigest[] = []
    for (const f of datedFiles) {
      try {
        const raw = await fs.readFile(path.join(DIGESTS_DIR, f), "utf8")
        digests.push(JSON.parse(raw) as AINewsDigest)
      } catch {
        // skip unreadable
      }
    }
    return { ok: true, digests }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    return {
      ok: false,
      digests: [],
      error: code === "ENOENT" ? "digests 目录尚未生成" : String(e),
    }
  }
}

export function groupByCompany(events: AINewsEvent[]): Map<AINewsCompany, AINewsEvent[]> {
  const m = new Map<AINewsCompany, AINewsEvent[]>()
  for (const e of events) {
    const arr = m.get(e.company) ?? []
    arr.push(e)
    m.set(e.company, arr)
  }
  for (const arr of m.values()) {
    arr.sort((a, b) => b.importance_score - a.importance_score)
  }
  return m
}
