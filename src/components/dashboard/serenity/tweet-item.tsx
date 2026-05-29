import type { ReactNode } from "react"
import { TICKER_RE, safeHttpUrl, type Tweet } from "@/lib/serenity-pure"

// 正文里的 $TICKER 高亮:split 复用 serenity-pure 的权威 TICKER_RE(单一来源,
// 与筛选/计数同口径),用 split + map 渲染 span(绝不 dangerouslySetInnerHTML),
// 对抓取来的不可信正文安全。
function renderText(text: string): ReactNode[] {
  return text.split(TICKER_RE).map((seg, i) =>
    seg && /^\$[A-Z]/.test(seg) ? (
      <span key={i} className="font-mono font-medium text-sky-300">
        {seg}
      </span>
    ) : (
      <span key={i}>{seg}</span>
    ),
  )
}

export function TweetItem({ t }: { t: Tweet }) {
  // url 来自抓取语料,校验 scheme:非 http(s) 不渲染为可点链接,防 javascript: 注入。
  const safeUrl = safeHttpUrl(t.url)
  return (
    <li className="group rounded-lg border border-zinc-800/60 bg-zinc-900/20 p-2.5 transition-colors hover:border-zinc-700 hover:bg-zinc-900/50">
      <div className="flex items-center justify-between text-[10px] text-zinc-500">
        <span className="tabular-nums">{t.timestamp.slice(0, 16).replace("T", " ")}</span>
        {safeUrl ? (
          <a
            href={safeUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 transition-colors hover:text-rose-300"
          >
            <span className="text-rose-400/70">♥</span>
            <span className="tabular-nums">{t.likesRaw}</span>
            <span className="opacity-0 transition-opacity group-hover:opacity-100">↗</span>
          </a>
        ) : (
          <span className="flex items-center gap-1">
            <span className="text-rose-400/70">♥</span>
            <span className="tabular-nums">{t.likesRaw}</span>
          </span>
        )}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-zinc-200">{renderText(t.text)}</p>
    </li>
  )
}
