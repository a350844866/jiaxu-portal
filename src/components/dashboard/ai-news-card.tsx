import Link from "next/link"
import { Newspaper } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  readToday,
  groupByCompany,
  companyMeta,
  companyOrder,
  primaryEventId,
  type AINewsEvent,
} from "@/lib/ai-news-reader"

const PER_COMPANY_PREVIEW = 3

function fmtAge(sec: number): string {
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}min`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`
  return `${Math.floor(sec / 86400)}d`
}

function scoreBadge(score: number) {
  let tone = "bg-zinc-700/60 text-zinc-300"
  if (score >= 13) tone = "bg-rose-500/30 text-rose-100"
  else if (score >= 10) tone = "bg-amber-500/25 text-amber-100"
  else if (score >= 7) tone = "bg-emerald-500/20 text-emerald-200"
  return (
    <span className={cn("shrink-0 rounded px-1 font-mono text-[10px] tabular-nums", tone)}>
      ⭐{score}
    </span>
  )
}

export async function AINewsCard() {
  const snap = await readToday()

  if (!snap.ok || !snap.digest) {
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
        <div className="mt-2 text-xs text-zinc-500">{snap.error}</div>
      </section>
    )
  }

  const digest = snap.digest
  const grouped = groupByCompany(digest.events)
  const orderedCompanies = companyOrder().filter((c) => grouped.has(c))

  return (
    <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Newspaper className="h-4 w-4 text-zinc-300" />
          <span className="text-sm font-medium text-zinc-200">AI 早报</span>
          <span className="text-xs text-zinc-500">
            {digest.date} · {digest.total_count} 条
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          {snap.ageSeconds !== null && <span>更新于 {fmtAge(snap.ageSeconds)} 前</span>}
          <Link href="/ai-news" className="hover:text-zinc-300">
            历史 →
          </Link>
        </div>
      </header>

      {orderedCompanies.length === 0 ? (
        <div className="mt-3 text-sm text-zinc-500">今日暂无 events</div>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {orderedCompanies.map((c) => {
            const items = grouped.get(c)!.slice(0, PER_COMPANY_PREVIEW)
            const fullCount = grouped.get(c)!.length
            const meta = companyMeta(c)
            return (
              <div
                key={c}
                className={cn("rounded-xl border bg-zinc-950/60 p-3", meta.tone)}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide">
                    {meta.emoji} {meta.label}
                  </span>
                  <span className="text-[10px] text-zinc-500">{fullCount}</span>
                </div>
                <ul className="mt-2 space-y-2 text-xs">
                  {items.map((ev, idx) => (
                    <EventRow key={idx} ev={ev} />
                  ))}
                  {fullCount > PER_COMPANY_PREVIEW && (
                    <li className="pl-1 text-[10px] text-zinc-500">
                      …{fullCount - PER_COMPANY_PREVIEW} 条更多
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

function fmtDate(iso?: string): string | null {
  if (!iso) return null
  try {
    const d = new Date(iso)
    const m = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    return `${m}-${day}`
  } catch {
    return null
  }
}

function EventRow({ ev }: { ev: AINewsEvent }) {
  const title = ev.title_zh || ev.title
  const url = ev.urls?.[0]
  const date = fmtDate(ev.published_at)
  const eventId = primaryEventId(ev)
  const titleClassName = "text-zinc-100 hover:text-zinc-50 hover:underline"
  return (
    <li className="leading-relaxed">
      <div className="flex items-start gap-1.5">
        {scoreBadge(ev.importance_score)}
        <div className="min-w-0 flex-1">
          {eventId !== null ? (
            <Link href={`/ai-news/${eventId}`} className={titleClassName}>
              {title}
            </Link>
          ) : url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className={titleClassName}
            >
              {title}
            </a>
          ) : (
            <span className="text-zinc-100">{title}</span>
          )}
          {(date || ev.is_first_seen_only) && (
            <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] text-zinc-500">
              {ev.is_first_seen_only ? (
                <span title="HTML diff 源：published_at 是首次抓到时间，不是真实发布日">
                  {date ? `首见 ${date}` : "首见"}
                </span>
              ) : (
                <span>{date}</span>
              )}
            </span>
          )}
          {ev.summary_zh && (
            <p className="mt-0.5 text-[11px] leading-snug text-zinc-400 line-clamp-2">
              {ev.summary_zh}
            </p>
          )}
          {ev.importance_reason && (
            <p className="mt-0.5 text-[11px] leading-snug text-zinc-500 line-clamp-1">
              💡 {ev.importance_reason}
            </p>
          )}
        </div>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 shrink-0 text-[11px] text-zinc-500 hover:text-zinc-300"
            aria-label="打开原始链接"
            title="打开原始链接"
          >
            ↗
          </a>
        )}
      </div>
    </li>
  )
}
