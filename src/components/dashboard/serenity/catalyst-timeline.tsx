import type { Catalyst } from "@/lib/serenity-pure"
import { PANEL } from "./theme"

// 第③幕:接下来盯什么。竖向时间线,首个节点(最近 catalyst)高亮。
export function CatalystTimeline({ catalysts }: { catalysts: Catalyst[] }) {
  if (!catalysts.length) {
    return <div className={`${PANEL} p-4 text-xs text-zinc-600`}>暂无前瞻 catalyst</div>
  }
  return (
    <div className={`${PANEL} p-4 sm:p-5`}>
      <ol className="relative space-y-4 border-l border-zinc-800 pl-6">
        {catalysts.map((c, i) => {
          const soon = i === 0
          return (
            <li key={i} className="relative">
              <span
                className={`absolute top-0.5 flex h-3 w-3 items-center justify-center rounded-full border-2 ${
                  soon ? "border-sky-400 bg-sky-400/30" : "border-zinc-600 bg-zinc-900"
                }`}
                style={{ left: "-1.86rem" }}
              >
                {soon && <span className="h-1 w-1 animate-ping rounded-full bg-sky-300" />}
              </span>
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <span
                  className={`font-mono text-xs tabular-nums ${soon ? "text-sky-300" : "text-zinc-400"}`}
                >
                  {c.date}
                </span>
                {soon && (
                  <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[9px] text-sky-300">
                    最近
                  </span>
                )}
                <span className="basis-full text-[10px] text-zinc-500 sm:basis-auto sm:ml-auto">
                  {c.chain}
                </span>
              </div>
              <p className="mt-1 text-sm leading-snug text-zinc-200">{c.event}</p>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
