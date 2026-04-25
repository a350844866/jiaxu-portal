/**
 * Parse the vault's TODO.md into a structured list for the dashboard.
 *
 * Format spec lives in obsidian-vault `CLAUDE.md` §13:
 *   - [ ] **[<system>]** description (added: YYYY-MM-DD)
 *     - sub-bullet (optional)
 *
 * Sections in TODO.md:
 *   - "## 进行中 / 短期(本周)"
 *   - "## 中期(2-4 周)"
 *   - "## 长期 / Phase 5 留扩展点"
 *   - "## 已完成(保留 1 个月)"
 *
 * The card surfaces open items only (`[ ]`), grouped by system tag.
 */
import { promises as fs } from "node:fs"
import path from "node:path"

export type Bucket = "short" | "mid" | "long" | "done" | "unknown"

export interface TodoItem {
  bucket: Bucket
  done: boolean
  system: string         // e.g. "mt5", "wiki", "meta"
  description: string    // text after the system tag
  added: string | null   // ISO date if (added: YYYY-MM-DD) suffix present
  subBullets: string[]   // raw text of indented bullets directly under this item
  raw: string            // original line (for fallback render)
}

export interface TodoSnapshot {
  ok: boolean
  error?: string
  generatedAt: string
  ageSeconds: number | null
  source: string
  items: TodoItem[]
}

const VAULT_DIR = process.env.VAULT_DIR || "/data/vault"
const TODO_PATH = path.join(VAULT_DIR, "TODO.md")

const BUCKET_HEADINGS: { match: RegExp; bucket: Bucket }[] = [
  { match: /短期|本周|进行中/, bucket: "short" },
  { match: /中期/, bucket: "mid" },
  { match: /长期|Phase\s*5/i, bucket: "long" },
  { match: /已完成/, bucket: "done" },
]

// Note: ES2017 target — no named capture groups. Order:
//   ITEM_RE: [1] checkbox char, [2] rest of line
//   HEAD_RE: [1] system tag, [2] description, [3] added date (optional)
const ITEM_RE = /^-\s+\[([ xX])\]\s+(.+)$/
const HEAD_RE = /^\*\*\[([^\]]+)\]\*\*\s+(.*?)(?:\s+\(added:\s*(\d{4}-\d{2}-\d{2})\))?\s*$/
const SUB_RE = /^\s{2,}-\s+(.+)$/

function classifyBucket(heading: string): Bucket {
  for (const b of BUCKET_HEADINGS) {
    if (b.match.test(heading)) return b.bucket
  }
  return "unknown"
}

function parseTodoMd(content: string): TodoItem[] {
  const lines = content.split(/\r?\n/)
  const items: TodoItem[] = []
  let bucket: Bucket = "unknown"
  let current: TodoItem | null = null

  for (const line of lines) {
    if (line.startsWith("## ")) {
      bucket = classifyBucket(line.slice(3))
      current = null
      continue
    }
    const m = ITEM_RE.exec(line)
    if (m) {
      const done = m[1].toLowerCase() === "x"
      const rest = m[2]
      const h = HEAD_RE.exec(rest)
      const item: TodoItem = h
        ? {
            bucket,
            done,
            system: h[1].trim(),
            description: h[2].trim(),
            added: h[3] || null,
            subBullets: [],
            raw: line,
          }
        : {
            bucket,
            done,
            system: "(untagged)",
            description: rest.trim(),
            added: null,
            subBullets: [],
            raw: line,
          }
      items.push(item)
      current = item
      continue
    }
    if (current) {
      const sm = SUB_RE.exec(line)
      if (sm) {
        current.subBullets.push(sm[1].trim())
        continue
      }
      // Blank or non-bullet line ends the current item's sub-list
      if (!line.trim()) {
        current = null
      }
    }
  }
  return items
}

export async function readTodoSnapshot(): Promise<TodoSnapshot> {
  const generatedAt = new Date().toISOString()
  try {
    const stat = await fs.stat(TODO_PATH)
    const content = await fs.readFile(TODO_PATH, "utf-8")
    const items = parseTodoMd(content)
    return {
      ok: true,
      generatedAt,
      ageSeconds: Math.round((Date.now() - stat.mtimeMs) / 1000),
      source: TODO_PATH,
      items,
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      generatedAt,
      ageSeconds: null,
      source: TODO_PATH,
      items: [],
    }
  }
}

export function groupBySystem(items: TodoItem[]): Map<string, TodoItem[]> {
  const m = new Map<string, TodoItem[]>()
  for (const it of items) {
    const key = it.system
    if (!m.has(key)) m.set(key, [])
    m.get(key)!.push(it)
  }
  return m
}

export const SYSTEM_LABELS: Record<string, { label: string; tone: string }> = {
  mt4:           { label: "MT4",           tone: "border-amber-500/30 bg-amber-500/5 text-amber-200" },
  mt5:           { label: "MT5",           tone: "border-yellow-500/30 bg-yellow-500/5 text-yellow-200" },
  "mt4-mt5":     { label: "MT4+MT5",       tone: "border-orange-500/30 bg-orange-500/5 text-orange-200" },
  "quant-flow":  { label: "quant-flow",    tone: "border-violet-500/30 bg-violet-500/5 text-violet-200" },
  ibkr:          { label: "IBKR",          tone: "border-sky-500/30 bg-sky-500/5 text-sky-200" },
  "jiaxu-portal":{ label: "portal",        tone: "border-emerald-500/30 bg-emerald-500/5 text-emerald-200" },
  "home-server": { label: "home-server",   tone: "border-teal-500/30 bg-teal-500/5 text-teal-200" },
  wiki:          { label: "wiki",          tone: "border-rose-500/30 bg-rose-500/5 text-rose-200" },
  meta:          { label: "meta",          tone: "border-zinc-500/30 bg-zinc-500/5 text-zinc-200" },
}

export const BUCKET_LABELS: Record<Bucket, string> = {
  short: "本周",
  mid: "2-4 周",
  long: "Phase 5",
  done: "已完成",
  unknown: "未分类",
}
