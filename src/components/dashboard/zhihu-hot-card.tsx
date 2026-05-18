/**
 * ZhihuHotCard — surfaces vault's daily zhihu hot list on portal main page.
 *
 * Server component: reads /data/vault/sources/zhihu-hot/YYYY-MM-DD.md.
 * Source: /data/zhihu-hot-scraper/ systemd timer 08:00 daily.
 *
 * Items matching user-defined keywords (Claude Code / LLM / 量化 / 家服 /
 * 程序员副业 / AI 实战) are highlighted in red as "推荐回答".
 *
 * Card defaults to collapsed (native <details>) — 30 items is too long for
 * default expanded.
 */
import { Flame } from "lucide-react"
import { readZhihuToday } from "@/lib/zhihu-hot-reader"
import { cn } from "@/lib/utils"

function fmtAge(sec: number | null | undefined): string {
  if (sec == null) return ""
  if (sec < 60) return `${sec}s 前`
  if (sec < 3600) return `${Math.floor(sec / 60)}min 前`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h 前`
  return `${Math.floor(sec / 86400)}d 前`
}

export async function ZhihuHotCard() {
  const snap = await readZhihuToday()

  if (!snap.ok) {
    return (
      <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4 text-sm">
        <header className="flex items-center gap-2 text-zinc-300">
          <Flame className="h-4 w-4 text-zinc-400" />
          <span className="font-medium">知乎热榜</span>
        </header>
        <div className="mt-2 text-xs text-rose-400">{snap.error}</div>
      </section>
    )
  }

  const { date, source, total, items, matchedCount, ageSeconds } = snap
  const recommended = items.filter((i) => i.matched)
  const others = items.filter((i) => !i.matched)

  return (
    <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/40">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between p-4 hover:bg-zinc-900/30">
          <div className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-orange-400" />
            <span className="text-sm font-medium text-zinc-200">知乎热榜</span>
            <span className="text-xs text-zinc-500">
              {date} · {total} 条
            </span>
            {matchedCount > 0 && (
              <span className="rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-300">
                推荐 {matchedCount} 条
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span title="数据源 + 抓取时间">
              {source} · {fmtAge(ageSeconds)}
            </span>
            <span className="text-zinc-600 group-open:hidden">展开 ▾</span>
            <span className="hidden text-zinc-600 group-open:inline">收起 ▴</span>
          </div>
        </summary>

        <div className="px-4 pb-4">
          {recommended.length > 0 && (
            <div className="mb-3">
              <div className="mb-1.5 text-[11px] uppercase tracking-wide text-rose-400">
                推荐回答(匹配你定位)
              </div>
              <ul className="space-y-1.5">
                {recommended.map((it) => (
                  <HotRow key={it.rank} item={it} />
                ))}
              </ul>
            </div>
          )}
          <div>
            {recommended.length > 0 && (
              <div className="mb-1.5 text-[11px] uppercase tracking-wide text-zinc-500">
                其它
              </div>
            )}
            <ul className="space-y-1.5">
              {others.map((it) => (
                <HotRow key={it.rank} item={it} />
              ))}
            </ul>
          </div>
        </div>
      </details>
    </section>
  )
}

function HotRow({ item }: { item: { rank: number; title: string; hot: string; ansFollow: string; url: string; matched: boolean } }) {
  return (
    <li className="flex items-baseline gap-2 text-xs leading-relaxed">
      <span
        className={cn(
          "w-5 flex-shrink-0 text-right font-mono text-[10px]",
          item.matched ? "text-rose-400" : "text-zinc-600",
        )}
      >
        {item.rank}
      </span>
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "min-w-0 flex-1 truncate hover:underline",
          item.matched
            ? "font-medium text-rose-300 hover:text-rose-200"
            : "text-zinc-200 hover:text-zinc-50",
        )}
        title={item.title}
      >
        {item.title}
      </a>
      <span className="flex-shrink-0 text-[10px] text-zinc-500">
        {item.hot}
      </span>
    </li>
  )
}
