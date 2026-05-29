"use client"
import { filterTweets, type Tweet } from "@/lib/serenity-pure"
import { X } from "lucide-react"
import { TweetItem } from "./tweet-item"

export function TickerDrawer({
  ticker,
  tweets,
  onClose,
}: {
  ticker: string | null
  tweets: Tweet[]
  onClose: () => void
}) {
  if (!ticker) return null
  const hits = filterTweets(tweets, { ticker }).slice(0, 50)
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-md flex-col border-l border-zinc-800 bg-zinc-950 animate-in slide-in-from-right duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div>
            <h3 className="font-mono text-sm font-semibold text-zinc-100">${ticker}</h3>
            <p className="text-[10px] text-zinc-500">命中 {hits.length} 条原推(最多 50)</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <ul className="flex-1 space-y-2 overflow-y-auto p-4">
          {hits.length === 0 ? (
            <p className="text-xs text-zinc-600">语料里没有提到这个 ticker</p>
          ) : (
            hits.map((t) => <TweetItem key={t.id} t={t} />)
          )}
        </ul>
      </div>
    </div>
  )
}
