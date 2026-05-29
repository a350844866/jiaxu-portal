import type { ReactNode } from "react"
import type { Tweet } from "@/lib/serenity-pure"

// 把正文里的 $TICKER 高亮。用 split + map 渲染 span(绝不 dangerouslySetInnerHTML),
// 对抓取来的不可信正文安全。
function renderText(text: string): ReactNode[] {
  return text.split(/(\$[A-Z]{1,6}(?:\.[A-Z])?)\b/g).map((seg, i) =>
    /^\$[A-Z]/.test(seg) ? (
      <span key={i} className="font-mono font-medium text-sky-300">
        {seg}
      </span>
    ) : (
      <span key={i}>{seg}</span>
    ),
  )
}

export function TweetItem({ t }: { t: Tweet }) {
  return (
    <li className="group rounded-lg border border-zinc-800/60 bg-zinc-900/20 p-2.5 transition-colors hover:border-zinc-700 hover:bg-zinc-900/50">
      <div className="flex items-center justify-between text-[10px] text-zinc-500">
        <span className="tabular-nums">{t.timestamp.slice(0, 16).replace("T", " ")}</span>
        <a
          href={t.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 transition-colors hover:text-rose-300"
        >
          <span className="text-rose-400/70">♥</span>
          <span className="tabular-nums">{t.likesRaw}</span>
          <span className="opacity-0 transition-opacity group-hover:opacity-100">↗</span>
        </a>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-zinc-200">{renderText(t.text)}</p>
    </li>
  )
}
