/**
 * Parse vault's daily zhihu hot list snapshot for the portal card.
 *
 * Source: /data/vault/sources/zhihu-hot/YYYY-MM-DD.md
 * Written by /data/zhihu-hot-scraper/scrape.py daily 08:00.
 * Format: see /data/zhihu-hot-scraper/README.md
 */
import fs from "node:fs/promises"
import path from "node:path"

const VAULT_DIR = process.env.VAULT_DIR || "/data/vault"
const ZHIHU_DIR = path.join(VAULT_DIR, "sources", "zhihu-hot")

export interface ZhihuItem {
  rank: number
  title: string
  hot: string
  ansFollow: string
  url: string
  matched: boolean
}

export interface ZhihuSnapshot {
  ok: boolean
  date?: string
  source?: string
  total?: number
  fetchedAt?: string
  items: ZhihuItem[]
  matchedCount: number
  ageSeconds?: number | null
  error?: string
}

// Keywords that flag a question as worth user attention.
// Conservative: avoid bare "AI" (false-positive on 爱情/AI 颜值 etc).
const HOT_KEYWORDS: string[] = [
  // AI / LLM
  "人工智能", "大模型", "LLM", "ChatGPT", "Claude", "GPT-", "GPT4", "GPT5",
  "Sonnet", "Opus", "DeepSeek", "Gemini", "Llama", "Qwen", "千问",
  "Agent", "智能体", "提示词", "Prompt", "RAG", "AGI", "OpenAI",
  "Anthropic", "黄仁勋", "英伟达", "NVIDIA",
  // 编程
  "程序员", "码农", "Cursor", "Copilot", "VSCode", "Codex", "Claude Code",
  "GitHub Copilot", "IDE", "TypeScript", "Rust",
  // 量化
  "量化", "回测", "Sharpe", "高频交易", "对冲基金", "对冲", "alpha",
  "FOMC", "美联储",
  // 自托管
  "Docker", "软路由", "NAS", "自建", "自托管", "K8s", "Kubernetes",
  "服务器", "Linux",
  // 副业
  "副业", "搞钱", "远程工作", "freelance",
  // 工具
  "Obsidian", "Notion",
]

function matchHot(title: string): boolean {
  const t = title.toLowerCase()
  for (const kw of HOT_KEYWORDS) {
    if (t.includes(kw.toLowerCase())) return true
  }
  return false
}

function parseRow(line: string): ZhihuItem | null {
  // | 1 | title | 1228 万热度 | 635 回 / 953 关 | [link](URL) |
  const cells = line.split("|").map((c) => c.trim())
  // [empty, "1", "title", "hot", "ansFollow", "[link](URL)", empty]
  if (cells.length < 6) return null
  const rankStr = cells[1]
  const rank = Number(rankStr)
  if (!Number.isFinite(rank) || rank <= 0) return null
  const title = cells[2]
  const hot = cells[3]
  const ansFollow = cells[4]
  const linkCell = cells[5]
  const linkMatch = linkCell.match(/\((.+?)\)/)
  const url = linkMatch ? linkMatch[1] : ""
  if (!title || !url) return null
  return {
    rank,
    title,
    hot,
    ansFollow,
    url,
    matched: matchHot(title),
  }
}

export async function readZhihuToday(): Promise<ZhihuSnapshot> {
  const today = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  const ymd = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
  const filePath = path.join(ZHIHU_DIR, `${ymd}.md`)

  let raw: string
  let stat: { mtimeMs: number } | null = null
  try {
    raw = await fs.readFile(filePath, "utf-8")
    stat = await fs.stat(filePath)
  } catch (e) {
    // Fall back to most recent file in dir (e.g., 08:00 hasn't fired yet today)
    try {
      const entries = await fs.readdir(ZHIHU_DIR)
      const mdFiles = entries
        .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
        .sort()
        .reverse()
      if (mdFiles.length === 0) {
        return {
          ok: false,
          items: [],
          matchedCount: 0,
          error: "no snapshot files in vault sources/zhihu-hot/",
        }
      }
      const fallback = path.join(ZHIHU_DIR, mdFiles[0])
      raw = await fs.readFile(fallback, "utf-8")
      stat = await fs.stat(fallback)
    } catch (e2) {
      return {
        ok: false,
        items: [],
        matchedCount: 0,
        error: `read failed: ${(e as Error).message}`,
      }
    }
  }

  // Parse header metadata
  const lines = raw.split("\n")
  let date = ""
  let source = ""
  let total = 0
  let fetchedAt = ""

  for (const line of lines.slice(0, 10)) {
    const mDate = line.match(/^# 知乎热榜 (\d{4}-\d{2}-\d{2})/)
    if (mDate) date = mDate[1]
    const mTime = line.match(/抓取时间:`([^`]+)`/)
    if (mTime) fetchedAt = mTime[1]
    const mSrc = line.match(/数据源:`([^`]+)`/)
    if (mSrc) source = mSrc[1]
    const mTotal = line.match(/条目数:(\d+)/)
    if (mTotal) total = Number(mTotal[1])
  }

  // Parse table rows
  const items: ZhihuItem[] = []
  for (const line of lines) {
    if (!line.startsWith("| ")) continue
    if (line.includes("---")) continue
    if (line.includes(" # |")) continue // header row
    const item = parseRow(line)
    if (item) items.push(item)
  }

  const matchedCount = items.filter((i) => i.matched).length
  const ageSeconds = stat
    ? Math.floor((Date.now() - stat.mtimeMs) / 1000)
    : null

  return {
    ok: true,
    date,
    source,
    total: total || items.length,
    fetchedAt,
    items,
    matchedCount,
    ageSeconds,
  }
}
