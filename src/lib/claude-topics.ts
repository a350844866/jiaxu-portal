/**
 * claude-topics — 读宿主写的 Claude 用量主题归因快照.
 *
 * 数据链路:
 *   宿主 systemd timer(5min) → /data/claude-usage/claude-topic-snapshot.sh
 *     → report_claude_topic_usage.py --compact(扫两台机的会话 jsonl, ~10s)
 *     → 原子写 /data/portal-state/claude-topics.json  (本模块只读这一步产物)
 *
 * 为什么不在请求里现算: 整月要扫 3000+ jsonl / ~10s, 放进 HTTP 会让首页每次刷新都卡住.
 * 代价是数据最多陈旧 5 分钟 —— 所以本模块**总是返回 ageSeconds/stale**, 由卡片如实展示,
 * 不假装实时(同 cron-snapshot / state-hub 的既有做法).
 *
 * 与 usage_events(MySQL, TokenCard 用) 的关系: 那条是权威成本流水; 这条是同一批 jsonl
 * 的**语义归因**副产物, 整月总额与 DB 逐分钱对齐(生成侧 --verify-db 已验).
 */
import { promises as fs } from "node:fs"
import path from "node:path"

const STATE_DIR = process.env.PORTAL_STATE_DIR || "/data/portal-state"
const SNAPSHOT_PATH = path.join(STATE_DIR, "claude-topics.json")
const REPORT_PATH = path.join(STATE_DIR, "claude-topics.md")
/** timer 是 5min 一跳; 连丢 3 跳(15min)才算真出问题, 与 cron-snapshot 阈值一致 */
const STALE_MS = 15 * 60 * 1000

/** 战线/模型/机器 桶。`name` 只在 by_topic 出现——中文名由生成侧(report 脚本的
 *  WORKSTREAM_NAME)随快照下发，前端不再维护第二份映射表，防两处分叉。 */
export type Bucket = { cost: number; tok: number; tasks: number; msgs?: number; name?: string }

export type TopicSnapshot = {
  meta: {
    start: string
    end: string
    generated_at: string
    n_tasks: number
    n_messages: number
    total_tokens: number
    total_cost_usd: number
    subagent_cost_usd: number
    tz_offset: number
  }
  by_mode: Record<string, Bucket>
  by_topic: Record<string, Bucket>
  by_worktype: Record<string, Bucket>
  by_host: Record<string, Bucket>
  by_model: Record<string, Bucket>
  days: { d: string; i: number; a: number; n: number }[]
}

export type TopicResult =
  | { ok: true; data: TopicSnapshot; ageSeconds: number; stale: boolean }
  | { ok: false; error: string; ageSeconds: number | null; stale: true }

export async function fetchTopicSnapshot(): Promise<TopicResult> {
  try {
    const [stat, raw] = await Promise.all([
      fs.stat(SNAPSHOT_PATH),
      fs.readFile(SNAPSHOT_PATH, "utf8"),
    ])
    const data = JSON.parse(raw) as TopicSnapshot
    if (!data?.meta || !data?.by_mode || !data?.by_topic) {
      return { ok: false, error: "快照结构异常(缺 meta/by_mode/by_topic)", ageSeconds: null, stale: true }
    }
    const ageMs = Date.now() - stat.mtimeMs
    return { ok: true, data, ageSeconds: Math.round(ageMs / 1000), stale: ageMs > STALE_MS }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    return {
      ok: false,
      // 明确区分"还没生成过"和"读坏了" —— 前者是首次部署未跑 timer, 后者要查宿主
      error: code === "ENOENT" ? "快照尚未生成(宿主 timer 未跑过?)" : String(e),
      ageSeconds: null,
      stale: true,
    }
  }
}

/** 完整 Markdown 报告原文, 供 /api/claude-topics?format=md 直出 */
export async function fetchTopicReportMarkdown(): Promise<string | null> {
  try {
    return await fs.readFile(REPORT_PATH, "utf8")
  } catch {
    return null
  }
}

/** 相对时间, 中文短句(卡片头部用) */
export function ageLabel(sec: number | null): string {
  if (sec == null) return "无数据"
  if (sec < 90) return `${Math.max(0, sec)} 秒前`
  const m = Math.round(sec / 60)
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h} 小时前` : `${Math.floor(h / 24)} 天前`
}
