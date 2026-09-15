/**
 * GlmUsageCard — cpclaude(部门 GLM 网关)token 用量卡片(默认收起).
 *
 * Server component: 只读宿主 5min 快照(@/lib/glm-usage). 快照里只有数字 + 模型/机器/项目目录名 ——
 * 会话文本 / prompt / 公司代码在来源机抽取阶段就丢弃了, 不进快照也不进 portal.
 *
 * 口径: 按 message.id 去重(流式分块同 id 多行, 取 token 合计最大), 北京时间日/月边界, host 分桶互斥.
 * 额度: 2026-09-15 实测部门网关无额度/余额接口 → 如实显示, 不编额度; 无价目出处 → 只显示 token 不折算金额.
 */
import { Cpu } from "lucide-react"
import { fetchGlmUsage } from "@/lib/glm-usage"
import {
  ageLabel,
  bucketTitle,
  fmtTokens,
  hostSyncLabel,
  quotaText,
  sortBuckets,
  type GlmBucket,
  type GlmHost,
} from "@/lib/glm-usage-pure"
import { cn } from "@/lib/utils"

function Header() {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Cpu className="h-4 w-4 flex-shrink-0 text-teal-400" />
      <span className="text-sm font-medium text-zinc-200">cpclaude 用量</span>
      <span className="text-xs text-zinc-500">部门 GLM 网关 · token 口径</span>
    </div>
  )
}

function BucketBars({
  title,
  entries,
  tone,
  labelOf,
  side,
}: {
  title: string
  entries: [string, GlmBucket][]
  tone: string
  labelOf?: (k: string) => string
  side?: (k: string) => { text: string; warn: boolean } | null
}) {
  const max = entries.length ? entries[0][1].total : 0
  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-xs font-medium text-zinc-400">{title}</h3>
      {entries.length === 0 ? (
        <div className="text-xs text-zinc-600">本月无记录</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {entries.map(([k, b]) => {
            const s = side?.(k)
            return (
              <div key={k} className="text-xs" title={bucketTitle(b)}>
                <div className="flex items-center gap-2.5">
                  <span className="w-28 flex-shrink-0 truncate text-zinc-300">{labelOf ? labelOf(k) : k}</span>
                  <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-800">
                    <div className={cn("h-full rounded-full", tone)} style={{ width: `${max > 0 ? (b.total / max) * 100 : 0}%` }} />
                  </div>
                  <span className="w-14 flex-shrink-0 text-right font-mono tabular-nums text-zinc-200">{fmtTokens(b.total)}</span>
                </div>
                {s && <div className={cn("mt-0.5 truncate text-[11px]", s.warn ? "text-amber-400" : "text-zinc-600")}>{s.text}</div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export async function GlmUsageCard() {
  const r = await fetchGlmUsage()

  if (!r.ok) {
    return (
      <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4 text-sm">
        <Header />
        <div className={cn("mt-2 text-xs", r.kind === "missing" ? "text-amber-400" : "text-rose-400")}>{r.error}</div>
      </section>
    )
  }

  const { data, stale, dayRolled, monthRolled } = r
  const month = data.windows.month
  const today = data.windows.today
  const hostsByKey = new Map<string, GlmHost>(data.hosts.map((h) => [h.host, h]))
  const troubled = data.hosts.filter((h) => hostSyncLabel(h).warn)

  // 机器桶: 本月有量的 + 预期但没数据的(帧缺失也要露出来, 不能静默少算一台)
  const hostEntries = sortBuckets(month.by_host)
  for (const h of data.hosts) {
    if (!month.by_host[h.host]) hostEntries.push([h.host, { input: 0, cache_read: 0, cache_creation: 0, output: 0, total: 0, msgs: 0 }])
  }

  const rows: [string, GlmBucket][] = [
    [`本月（${data.month}）${monthRolled ? " · 已跨月" : ""}`, month.totals],
    [`今日（${data.today.slice(5)}）${dayRolled ? " · 日界已翻" : ""}`, today.totals],
  ]

  return (
    <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/40">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 hover:bg-zinc-900/30">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Header />
            {/* 收起态一行: 本月合计 + 额度状态 */}
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              {/* 快照跨了北京午夜/月初而下一帧未到: 标出快照所属日期, 不把昨天的数叫"今日" */}
              <span className={cn("text-xs", monthRolled ? "text-amber-400" : "text-zinc-500")}>
                {monthRolled ? `${data.month}（已跨月）` : "本月"}
              </span>
              <span className="font-mono text-xl tabular-nums text-zinc-100">{fmtTokens(month.totals.total)}</span>
              <span className={cn("font-mono text-xs tabular-nums", dayRolled ? "text-amber-400" : "text-zinc-400")}>
                {dayRolled ? `${data.today.slice(5)}（已翻日）` : "今日"} {fmtTokens(today.totals.total)}
              </span>
              <span className="font-mono text-xs tabular-nums text-zinc-500">
                {month.totals.msgs.toLocaleString()} 条回复
              </span>
              <span className="text-xs text-zinc-400" title={data.quota?.detail ?? undefined}>
                {quotaText(data.quota)}
              </span>
              {troubled.length > 0 && (
                <span className="text-xs text-amber-400">{troubled.length} 台来源异常或未同步</span>
              )}
            </div>
          </div>
          <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
            <span
              className={cn("text-xs", stale ? "text-amber-400" : "text-zinc-600")}
              title={`快照生成于 ${data.generated_at}（宿主 5 分钟一跳）`}
            >
              快照 {ageLabel(r.ageSeconds)}
              {stale && " · 已陈旧"}
            </span>
            <span className="text-xs text-zinc-600">
              <span className="group-open:hidden">展开 ▾</span>
              <span className="hidden group-open:inline">收起 ▴</span>
            </span>
          </div>
        </summary>

        <div className="flex flex-col gap-5 px-4 pb-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs tabular-nums">
              <thead>
                <tr className="text-zinc-500">
                  <th className="py-1 text-left font-normal">窗口</th>
                  <th className="py-1 text-right font-normal">input</th>
                  <th className="py-1 text-right font-normal">cache_read</th>
                  <th className="py-1 text-right font-normal">cache_creation</th>
                  <th className="py-1 text-right font-normal">output</th>
                  <th className="py-1 text-right font-normal">合计</th>
                  <th className="py-1 text-right font-normal">回复</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, b]) => (
                  <tr key={label} className="border-t border-zinc-800/60">
                    <td className="py-1.5 text-zinc-300">{label}</td>
                    <td className="py-1.5 text-right font-mono text-zinc-300">{fmtTokens(b.input)}</td>
                    <td className="py-1.5 text-right font-mono text-zinc-300">{fmtTokens(b.cache_read)}</td>
                    <td className="py-1.5 text-right font-mono text-zinc-500">{fmtTokens(b.cache_creation)}</td>
                    <td className="py-1.5 text-right font-mono text-zinc-300">{fmtTokens(b.output)}</td>
                    <td className="py-1.5 text-right font-mono text-zinc-100">{fmtTokens(b.total)}</td>
                    <td className="py-1.5 text-right font-mono text-zinc-500">{b.msgs.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-5 border-t border-zinc-800/60 pt-4 md:grid-cols-3">
            <BucketBars title="本月 · 按模型" entries={sortBuckets(month.by_model)} tone="bg-teal-500" />
            <BucketBars
              title="本月 · 按机器"
              entries={hostEntries}
              tone="bg-violet-500"
              labelOf={(k) => hostsByKey.get(k)?.label ?? k}
              side={(k) => {
                const h = hostsByKey.get(k)
                return h ? hostSyncLabel(h) : null
              }}
            />
            <BucketBars
              title={`本月 · 按项目${month.projects_omitted > 0 ? `（另 ${month.projects_omitted} 个已合并）` : ""}`}
              entries={sortBuckets(month.by_project)}
              tone="bg-sky-600/70"
            />
          </div>

          <div className="border-t border-zinc-800/60 pt-3 text-xs">
            <div className="text-zinc-300">{quotaText(data.quota)}</div>
            {data.quota?.detail && <div className="mt-1 leading-relaxed text-zinc-600">{data.quota.detail}</div>}
            {data.quota?.probed_at && <div className="mt-1 text-zinc-600">探测于 {data.quota.probed_at} · 无价目出处，不折算金额</div>}
          </div>

          <div className="border-t border-zinc-800/60 pt-2.5 text-[11px] leading-relaxed text-zinc-600">
            按 message.id 去重：本轮来源帧原始 {data.dedup.raw_usage_lines.toLocaleString()} 行 → 帧内{" "}
            {data.dedup.frame_unique_msgs.toLocaleString()} 条 · 家服账本累计计入 {data.dedup.counted_msgs.toLocaleString()} 条
            {data.dedup.cross_host_dups > 0 && <span className="text-amber-400"> · 跨机重复 {data.dedup.cross_host_dups} 条（只计一次）</span>}
            {data.dedup.undated_msgs > 0 && <span> · {data.dedup.undated_msgs} 条无时间戳（不进本月/今日）</span>}
            {" · "}北京时间日/月边界 · 仅统计数字，不含会话内容
          </div>
        </div>
      </details>
    </section>
  )
}
