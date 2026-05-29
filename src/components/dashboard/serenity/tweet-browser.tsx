"use client"
import { useMemo, useState } from "react"
import { filterTweets, type Tweet } from "@/lib/serenity-reader"

const PAGE = 30

export function TweetBrowser({ tweets }: { tweets: Tweet[] }) {
  const [q, setQ] = useState("")
  const [ticker, setTicker] = useState("")
  const [minLikes, setMinLikes] = useState(0)
  const [page, setPage] = useState(0)

  const filtered = useMemo(
    () => filterTweets(tweets, { q: q || undefined, ticker: ticker || undefined, minLikes: minLikes || undefined }),
    [tweets, q, ticker, minLikes],
  )
  const shown = filtered.slice(0, (page + 1) * PAGE)

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <h3 className="mb-3 text-xs font-medium text-zinc-400">推文浏览器 ({filtered.length})</h3>
      <div className="mb-3 flex flex-wrap gap-2">
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }}
          placeholder="搜正文…" className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200" />
        <input value={ticker} onChange={(e) => { setTicker(e.target.value); setPage(0) }}
          placeholder="ticker" className="w-24 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200" />
        <select value={minLikes} onChange={(e) => { setMinLikes(Number(e.target.value)); setPage(0) }}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200">
          <option value={0}>全部赞</option>
          <option value={100}>≥100</option>
          <option value={500}>≥500</option>
          <option value={1000}>≥1K</option>
        </select>
      </div>
      <ul className="space-y-2">
        {shown.map((t) => (
          <li key={t.id} className="rounded border border-zinc-800/60 p-2 text-xs">
            <div className="flex items-center justify-between text-[10px] text-zinc-500">
              <span>{t.timestamp.slice(0, 16).replace("T", " ")}</span>
              <a href={t.url} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">♥ {t.likesRaw} ↗</a>
            </div>
            <p className="mt-1 leading-relaxed text-zinc-200">{t.text}</p>
          </li>
        ))}
      </ul>
      {shown.length < filtered.length && (
        <button onClick={() => setPage((p) => p + 1)}
          className="mt-3 w-full rounded border border-zinc-700 py-1.5 text-xs text-zinc-400 hover:bg-zinc-900">
          加载更多 ({filtered.length - shown.length})
        </button>
      )}
    </section>
  )
}
