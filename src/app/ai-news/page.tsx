import Link from "next/link"
import { Newspaper, ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  readRecent,
  companyMeta,
  primaryEventId,
  type AINewsEvent,
} from "@/lib/ai-news-reader"

export const revalidate = 60
export const dynamic = "force-dynamic"

function scoreBadge(score: number) {
  let tone = "bg-zinc-700/60 text-zinc-300"
  if (score >= 13) tone = "bg-rose-500/30 text-rose-100"
  else if (score >= 10) tone = "bg-amber-500/25 text-amber-100"
  else if (score >= 7) tone = "bg-emerald-500/20 text-emerald-200"
  return (
    <span className={cn("shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums", tone)}>
      ⭐{score}
    </span>
  )
}

export default async function AINewsHistoryPage() {
  const data = await readRecent(30)

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200"
        >
          <ArrowLeft className="h-4 w-4" /> 返回
        </Link>
        <h1 className="flex items-center gap-2 text-base font-medium text-zinc-200">
          <Newspaper className="h-4 w-4" /> AI News 历史 (近 30 天)
        </h1>
        <span className="w-12" />
      </div>

      {!data.ok && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 text-sm text-rose-400">
          {data.error}
        </div>
      )}

      {data.ok && data.digests.length === 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 text-sm text-zinc-500">
          暂无 digest。
        </div>
      )}

      <div className="space-y-6">
        {data.digests.map((d) => (
          <section key={d.date} className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4">
            <header className="mb-3 flex items-center justify-between">
              <h2 className="font-mono text-sm font-medium text-zinc-200">{d.date}</h2>
              <span className="text-xs text-zinc-500">{d.total_count} 条</span>
            </header>
            <ul className="space-y-2">
              {d.events
                .slice()
                .sort((a, b) => b.importance_score - a.importance_score)
                .map((ev, idx) => (
                  <EventRow key={idx} ev={ev} />
                ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  )
}

function EventRow({ ev }: { ev: AINewsEvent }) {
  const meta = companyMeta(ev.company)
  const title = ev.title_zh || ev.title
  const url = ev.urls?.[0]
  const eventId = primaryEventId(ev)
  const inner = (
    <div className="flex items-start gap-2">
      {scoreBadge(ev.importance_score)}
      <span
        className={cn(
          "shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
          meta.tone,
        )}
      >
        {meta.emoji} {meta.label}
      </span>
      <span className="shrink-0 rounded bg-zinc-800/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-300">
        {ev.category}
      </span>
      <div className="min-w-0">
        <div className="text-sm text-zinc-100">{title}</div>
        {ev.summary_zh && (
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">{ev.summary_zh}</p>
        )}
      </div>
    </div>
  )
  if (eventId !== null) {
    return (
      <li>
        <Link
          href={`/ai-news/${eventId}`}
          className="block rounded-lg border border-transparent p-2 hover:border-zinc-700 hover:bg-zinc-900/40"
        >
          {inner}
        </Link>
      </li>
    )
  }
  if (url) {
    return (
      <li>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-lg border border-transparent p-2 hover:border-zinc-700 hover:bg-zinc-900/40"
        >
          {inner}
        </a>
      </li>
    )
  }
  return <li className="p-2">{inner}</li>
}
