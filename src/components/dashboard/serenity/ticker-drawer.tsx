"use client"
import { filterTweets, type Tweet } from "@/lib/serenity-reader"
import { X } from "lucide-react"

export function TickerDrawer({ ticker, tweets, onClose }: { ticker: string | null; tweets: Tweet[]; onClose: () => void }) {
  if (!ticker) return null
  const hits = filterTweets(tweets, { ticker }).slice(0, 50)
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-mono text-sm text-zinc-100">${ticker} 原推 ({hits.length})</h3>
          <button onClick={onClose}><X className="h-4 w-4 text-zinc-400" /></button>
        </div>
        <ul className="space-y-2">
          {hits.map((t) => (
            <li key={t.id} className="rounded border border-zinc-800/60 p-2 text-xs">
              <div className="flex items-center justify-between text-[10px] text-zinc-500">
                <span>{t.timestamp.slice(0, 16).replace("T", " ")}</span>
                <a href={t.url} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">♥ {t.likesRaw} ↗</a>
              </div>
              <p className="mt-1 leading-relaxed text-zinc-200">{t.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
