import Link from "next/link"
import { Newspaper, ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  readToday,
  readDailies,
  orderSections,
  sectionMeta,
  totalItems,
} from "@/lib/ai-news-reader"

export const revalidate = 600
export const dynamic = "force-dynamic"

export default async function AINewsPage() {
  const [today, dailies] = await Promise.all([readToday(), readDailies(30)])

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
          <Newspaper className="h-4 w-4" /> AI 早报
        </h1>
        <a
          href="https://aihot.virxact.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          aihot ↗
        </a>
      </div>

      {today.ok && today.daily && (
        <DailyBlock daily={today.daily} highlight />
      )}

      {dailies.ok && dailies.items.length > 1 && (
        <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4">
          <h2 className="text-sm font-medium text-zinc-200">近 30 天日报索引</h2>
          <ul className="mt-3 space-y-1.5 text-sm">
            {dailies.items
              .filter((d) => d.date !== today.daily?.date)
              .map((d) => (
                <li key={d.date}>
                  <a
                    href={`https://aihot.virxact.com/d/${d.date}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded p-1.5 hover:bg-zinc-900/40"
                  >
                    <span className="font-mono text-xs text-zinc-500">{d.date}</span>
                    <span className="flex-1 truncate text-zinc-200">
                      {d.leadTitle || "(无 lead title)"}
                    </span>
                    <span className="text-[10px] text-zinc-600">aihot ↗</span>
                  </a>
                </li>
              ))}
          </ul>
        </section>
      )}

      {!today.ok && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 text-sm text-rose-400">
          {today.error}
        </div>
      )}
    </main>
  )
}

function DailyBlock({
  daily,
  highlight = false,
}: {
  daily: NonNullable<Awaited<ReturnType<typeof readToday>>["daily"]>
  highlight?: boolean
}) {
  const sections = orderSections(daily.sections).filter((s) => s.items.length > 0)
  const total = totalItems(daily)

  return (
    <section
      className={cn(
        "rounded-2xl border bg-zinc-950/40 p-4",
        highlight ? "border-zinc-700" : "border-zinc-800",
      )}
    >
      <header className="mb-3 flex items-center justify-between">
        <h2 className="font-mono text-sm font-medium text-zinc-200">{daily.date}</h2>
        <span className="text-xs text-zinc-500">{total} 条</span>
      </header>
      <div className="space-y-4">
        {sections.map((sec) => {
          const meta = sectionMeta(sec.label)
          return (
            <div key={sec.label}>
              <div className="mb-2 flex items-center gap-2">
                <span
                  className={cn(
                    "rounded border px-1.5 py-0.5 text-[11px] font-medium",
                    meta.tone,
                  )}
                >
                  {meta.emoji} {sec.label}
                </span>
                <span className="text-[10px] text-zinc-500">{sec.items.length} 条</span>
              </div>
              <ul className="space-y-2 pl-2">
                {sec.items.map((it, idx) => (
                  <li key={idx} className="text-sm">
                    <a
                      href={it.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-zinc-100 hover:underline"
                    >
                      {it.title}
                    </a>
                    {it.sourceName && (
                      <span className="ml-1.5 text-[11px] text-zinc-500">· {it.sourceName}</span>
                    )}
                    {it.summary && (
                      <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">
                        {it.summary}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </section>
  )
}
