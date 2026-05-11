// AI 早报数据源 = aihot.virxact.com 公开 API (by 数字生命卡兹克)
// 自建 ai-news-corpus 于 2026-05-11 替换为本接入,JSON 文件读取改为远端 fetch.

const AIHOT_BASE = "https://aihot.virxact.com"
const AIHOT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

export interface AihotItem {
  title: string
  summary: string | null
  sourceUrl: string
  sourceName: string
}

export interface AihotSection {
  label: string
  items: AihotItem[]
}

export interface AihotDaily {
  date: string
  generatedAt: string
  windowStart?: string
  windowEnd?: string
  lead: { title?: string; paragraph?: string } | null
  sections: AihotSection[]
}

export interface AihotDailyIndex {
  date: string
  generatedAt: string
  leadTitle: string | null
  leadParagraph: string | null
}

export interface AihotDailySnapshot {
  ok: boolean
  error?: string
  ageSeconds: number | null
  fetchedAt: string | null
  daily: AihotDaily | null
}

export interface AihotDailiesList {
  ok: boolean
  error?: string
  items: AihotDailyIndex[]
}

const SECTION_META: Record<string, { emoji: string; tone: string }> = {
  "模型发布/更新": { emoji: "🧠", tone: "border-violet-500/30 bg-violet-500/5 text-violet-100" },
  "产品发布/更新": { emoji: "🚀", tone: "border-emerald-500/30 bg-emerald-500/5 text-emerald-100" },
  "行业动态":       { emoji: "🏭", tone: "border-amber-500/30 bg-amber-500/5 text-amber-100" },
  "论文":           { emoji: "📄", tone: "border-sky-500/30 bg-sky-500/5 text-sky-100" },
  "技巧与观点":     { emoji: "💡", tone: "border-zinc-400/30 bg-zinc-500/5 text-zinc-100" },
}

const SECTION_ORDER = ["模型发布/更新", "产品发布/更新", "行业动态", "论文", "技巧与观点"]

export function sectionMeta(label: string) {
  return SECTION_META[label] ?? { emoji: "🔹", tone: "border-zinc-500/30 bg-zinc-500/5 text-zinc-300" }
}

export function orderSections(sections: AihotSection[]): AihotSection[] {
  const idx = (label: string) => {
    const i = SECTION_ORDER.indexOf(label)
    return i === -1 ? 999 : i
  }
  return [...sections].sort((a, b) => idx(a.label) - idx(b.label))
}

async function fetchJsonWithMeta<T>(url: string): Promise<{ data: T; fetchedAt: string | null }> {
  const resp = await fetch(url, {
    headers: { "User-Agent": AIHOT_UA, Accept: "application/json" },
    next: { revalidate: 600 },
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  // Date header is the upstream response time; Next caches it alongside body,
  // so cache hits return the original fetch time — exactly what we want to surface.
  const fetchedAt = resp.headers.get("date")
  const data = (await resp.json()) as T
  return { data, fetchedAt }
}

async function fetchJson<T>(url: string): Promise<T> {
  const { data } = await fetchJsonWithMeta<T>(url)
  return data
}

export async function readToday(): Promise<AihotDailySnapshot> {
  try {
    const { data: daily, fetchedAt } = await fetchJsonWithMeta<AihotDaily>(
      `${AIHOT_BASE}/api/public/daily`,
    )
    const ageMs = Date.now() - new Date(daily.generatedAt).getTime()
    return { ok: true, ageSeconds: Math.max(0, Math.round(ageMs / 1000)), fetchedAt, daily }
  } catch (e) {
    return { ok: false, ageSeconds: null, fetchedAt: null, daily: null, error: String(e) }
  }
}

export async function readByDate(date: string): Promise<AihotDailySnapshot> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, ageSeconds: null, fetchedAt: null, daily: null, error: "invalid date format" }
  }
  try {
    const { data: daily, fetchedAt } = await fetchJsonWithMeta<AihotDaily>(
      `${AIHOT_BASE}/api/public/daily/${date}`,
    )
    const ageMs = Date.now() - new Date(daily.generatedAt).getTime()
    return { ok: true, ageSeconds: Math.max(0, Math.round(ageMs / 1000)), fetchedAt, daily }
  } catch (e) {
    return { ok: false, ageSeconds: null, fetchedAt: null, daily: null, error: String(e) }
  }
}

export async function readDailies(take: number = 30): Promise<AihotDailiesList> {
  try {
    const data = await fetchJson<{ count: number; items: AihotDailyIndex[] }>(
      `${AIHOT_BASE}/api/public/dailies?take=${take}`,
    )
    return { ok: true, items: data.items }
  } catch (e) {
    return { ok: false, items: [], error: String(e) }
  }
}

export function totalItems(daily: AihotDaily): number {
  return daily.sections.reduce((sum, s) => sum + s.items.length, 0)
}
