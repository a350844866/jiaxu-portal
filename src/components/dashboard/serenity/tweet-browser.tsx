"use client"
import { useMemo, useState } from "react"
import { Search } from "lucide-react"
import { filterTweets, type Tweet } from "@/lib/serenity-pure"
import { TweetItem } from "./tweet-item"
import { PANEL } from "./theme"

const PAGE = 30
const inputCls =
  "rounded-lg border border-zinc-700/70 bg-zinc-900/60 px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 transition-colors focus:border-sky-500/50 focus:outline-none focus:ring-1 focus:ring-sky-500/40"

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
    <div className={`${PANEL} p-4`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(0) }}
            placeholder="搜正文…"
            className={`${inputCls} w-full pl-7`}
          />
        </div>
        <input
          value={ticker}
          onChange={(e) => { setTicker(e.target.value); setPage(0) }}
          placeholder="ticker"
          className={`${inputCls} w-24`}
        />
        <select
          value={minLikes}
          onChange={(e) => { setMinLikes(Number(e.target.value)); setPage(0) }}
          className={inputCls}
        >
          <option value={0}>全部赞</option>
          <option value={100}>≥100</option>
          <option value={500}>≥500</option>
          <option value={1000}>≥1K</option>
        </select>
        <span className="ml-auto text-[10px] tabular-nums text-zinc-600">{filtered.length} 条</span>
      </div>
      {shown.length === 0 ? (
        <p className="py-6 text-center text-xs text-zinc-600">没有匹配的推文</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((t) => (
            <TweetItem key={t.id} t={t} />
          ))}
        </ul>
      )}
      {shown.length < filtered.length && (
        <button
          onClick={() => setPage((p) => p + 1)}
          className="mt-3 w-full rounded-lg border border-zinc-700/70 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:bg-zinc-900/60 hover:text-zinc-200"
        >
          加载更多 ({filtered.length - shown.length})
        </button>
      )}
    </div>
  )
}
