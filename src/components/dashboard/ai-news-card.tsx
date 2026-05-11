import Link from "next/link"
import { Newspaper } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  readToday,
  orderSections,
  sectionMeta,
  totalItems,
  type AihotItem,
} from "@/lib/ai-news-reader"

const PER_SECTION_PREVIEW = 3

function fmtAge(sec: number): string {
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}min`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`
  return `${Math.floor(sec / 86400)}d`
}

function fmtClock(iso: string | null): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const d = new Date(t)
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  return `${hh}:${mm}`
}

export async function AINewsCard() {
  const snap = await readToday()

  if (!snap.ok || !snap.daily) {
    return (
      <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4 text-sm">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Newspaper className="h-4 w-4 text-zinc-300" />
            <span className="text-sm font-medium text-zinc-200">AI 早报</span>
          </div>
          <Link href="/ai-news" className="text-xs text-zinc-500 hover:text-zinc-300">
            历史 →
          </Link>
        </header>
        <div className="mt-2 text-xs text-zinc-500">{snap.error || "加载失败"}</div>
      </section>
    )
  }

  const daily = snap.daily
  const sections = orderSections(daily.sections).filter((s) => s.items.length > 0)
  const total = totalItems(daily)

  return (
    <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Newspaper className="h-4 w-4 text-zinc-300" />
          <span className="text-sm font-medium text-zinc-200">AI 早报</span>
          <span className="text-xs text-zinc-500">
            {daily.date} · {total} 条
          </span>
          <a
            href="https://aihot.virxact.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-zinc-600 hover:text-zinc-400"
            title="数据源:数字生命卡兹克 aihot.virxact.com"
          >
            aihot ↗
          </a>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          {snap.ageSeconds !== null && (
            <span title="卡兹克生成日报的时间(每天北京 8 点)">
              日报生成于 {fmtAge(snap.ageSeconds)} 前
            </span>
          )}
          {snap.fetchedAt && (
            <span title={`本机拉取 aihot 的时间(每 10 分钟最多 1 次, ${snap.fetchedAt})`}>
              拉取于 {fmtClock(snap.fetchedAt)}
            </span>
          )}
          <Link href="/ai-news" className="hover:text-zinc-300">
            历史 →
          </Link>
        </div>
      </header>

      {sections.length === 0 ? (
        <div className="mt-3 text-sm text-zinc-500">今日暂无 events</div>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((sec) => {
            const meta = sectionMeta(sec.label)
            const preview = sec.items.slice(0, PER_SECTION_PREVIEW)
            const full = sec.items.length
            return (
              <div
                key={sec.label}
                className={cn("rounded-xl border bg-zinc-950/60 p-3", meta.tone)}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium tracking-wide">
                    {meta.emoji} {sec.label}
                  </span>
                  <span className="text-[10px] text-zinc-500">{full}</span>
                </div>
                <ul className="mt-2 space-y-2 text-xs">
                  {preview.map((it, idx) => (
                    <ItemRow key={idx} item={it} />
                  ))}
                  {full > PER_SECTION_PREVIEW && (
                    <li className="pl-1 text-[10px] text-zinc-500">
                      …{full - PER_SECTION_PREVIEW} 条更多
                    </li>
                  )}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function ItemRow({ item }: { item: AihotItem }) {
  return (
    <li className="leading-relaxed">
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-100 hover:text-zinc-50 hover:underline"
          >
            {item.title}
          </a>
          {item.sourceName && (
            <span className="ml-1.5 text-[10px] text-zinc-500">· {item.sourceName}</span>
          )}
          {item.summary && (
            <p className="mt-0.5 text-[11px] leading-snug text-zinc-400 line-clamp-2">
              {item.summary}
            </p>
          )}
        </div>
      </div>
    </li>
  )
}
