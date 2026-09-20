/**
 * GlmUsageCard — cpclaude(部门自部署 GLM)token 用量卡片(默认收起).
 *
 * Server component: 只读宿主 5min 快照(@/lib/glm-usage). 快照里只有数字 + 模型/机器/项目目录名 ——
 * 会话文本 / prompt / 公司代码在来源机抽取阶段就丢弃了, 不进快照也不进 portal.
 *
 * 口径: 按 message.id 去重(流式分块同 id 多行, 取 token 合计最大), 北京时间日/月边界, host 分桶互斥.
 * 额度: 部门自部署 GLM, 按用量使用、无额度.
 * 金额: 按各模型厂商官方 API 标价折算(价目来源/抓取日期随快照下发), 是「若按官方 API 购买」的参考, 不是实际计费.
 */
import { Cpu } from "lucide-react"
import { fetchGlmUsage } from "@/lib/glm-usage"
import {
  ageLabel,
  aliasGroups,
  bucketTitle,
  fmtCny,
  fmtTokens,
  hostSyncLabel,
  quotaText,
  sortBuckets,
  type GlmBucket,
  type GlmHost,
} from "@/lib/glm-usage-pure"
import { cn } from "@/lib/utils"

// 预期来源机本月没数据时补的占位桶: 金额是「未知」不是「零」, 显示 —
const EMPTY_BUCKET: GlmBucket = { input: 0, cache_read: 0, cache_creation: 0, output: 0, total: 0, msgs: 0, cny: null, unpriced_msgs: 0 }

function Header() {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Cpu className="h-4 w-4 flex-shrink-0 text-teal-400" />
      <span className="text-sm font-medium text-zinc-200">cpclaude 用量</span>
      <span className="text-xs text-zinc-500">部门 GLM 网关 · 金额为官方 API 标价折算</span>
    </div>
  )
}

function BucketBars({
  title,
  entries,
  tone,
  priced,
  labelOf,
  side,
}: {
  title: string
  entries: [string, GlmBucket][]
  tone: string
  priced: boolean
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
                  <span className="w-24 flex-shrink-0 truncate text-zinc-300">{labelOf ? labelOf(k) : k}</span>
                  <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-800">
                    <div className={cn("h-full rounded-full", tone)} style={{ width: `${max > 0 ? (b.total / max) * 100 : 0}%` }} />
                  </div>
                  <span className="w-14 flex-shrink-0 text-right font-mono tabular-nums text-zinc-200">{fmtTokens(b.total)}</span>
                  {priced && (
                    // md 三栏每栏只有 ~215px, 放不下条形 + 两列数字; lg 起再显示金额(明细在 title 里)
                    <span className="hidden w-14 flex-shrink-0 text-right font-mono tabular-nums text-zinc-500 lg:inline">{fmtCny(b.cny)}</span>
                  )}
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
  const pricing = data.pricing
  const priced = pricing !== null
  const hostsByKey = new Map<string, GlmHost>(data.hosts.map((h) => [h.host, h]))
  const troubled = data.hosts.filter((h) => hostSyncLabel(h).warn)
  const fetchedDates = pricing ? [...new Set(pricing.sources.map((x) => x.fetched_at).filter((d): d is string => d !== null))] : []
  const pricingTitle = pricing ? `${pricing.basis ?? "按官方标价折算"}（价目 ${fetchedDates.join(" / ") || "?"} 抓取）` : undefined

  // 机器桶: 本月有量的 + 预期但没数据的(帧缺失也要露出来, 不能静默少算一台)
  const hostEntries = sortBuckets(month.by_host)
  for (const h of data.hosts) {
    if (!month.by_host[h.host]) hostEntries.push([h.host, EMPTY_BUCKET])
  }

  const rows: [string, GlmBucket][] = [
    [`本月（${data.month}）${monthRolled ? " · 已跨月" : ""}`, month.totals],
    [`今日（${data.today.slice(5)}）${dayRolled ? " · 日界已翻" : ""}`, today.totals],
  ]
  const aliasText = pricing && Object.keys(pricing.aliases).length > 0 ? `别名按主名计价：${aliasGroups(pricing.aliases).join("；")}` : ""

  return (
    <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/40">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 hover:bg-zinc-900/30">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Header />
            {/* 收起态一行: 本月合计(token + 折算 ¥) + 额度状态 */}
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              {/* 快照跨了北京午夜/月初而下一帧未到: 标出快照所属日期, 不把昨天的数叫"今日" */}
              <span className={cn("text-xs", monthRolled ? "text-amber-400" : "text-zinc-500")}>
                {monthRolled ? `${data.month}（已跨月）` : "本月"}
              </span>
              <span className="font-mono text-xl tabular-nums text-zinc-100">{fmtTokens(month.totals.total)}</span>
              {priced && (
                <span
                  className="font-mono text-sm tabular-nums text-teal-300"
                  title={month.totals.unpriced_msgs > 0 ? `${pricingTitle}；${month.totals.unpriced_msgs} 条模型未定价，未计入` : pricingTitle}
                >
                  ≈ {fmtCny(month.totals.cny)}
                  {month.totals.unpriced_msgs > 0 && <span className="text-amber-400">*</span>}
                </span>
              )}
              <span className={cn("font-mono text-xs tabular-nums", dayRolled ? "text-amber-400" : "text-zinc-400")}>
                {dayRolled ? `${data.today.slice(5)}（已翻日）` : "今日"} {fmtTokens(today.totals.total)}
                {priced && ` · ${fmtCny(today.totals.cny)}`}
                {priced && today.totals.unpriced_msgs > 0 && <span className="text-amber-400">*</span>}
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
            <table className="w-full min-w-[600px] text-xs tabular-nums">
              <thead>
                <tr className="text-zinc-500">
                  <th className="py-1 text-left font-normal">窗口</th>
                  <th className="py-1 text-right font-normal">input</th>
                  <th className="py-1 text-right font-normal">cache_read</th>
                  <th className="py-1 text-right font-normal">cache_creation</th>
                  <th className="py-1 text-right font-normal">output</th>
                  <th className="py-1 text-right font-normal">合计</th>
                  <th className="py-1 text-right font-normal">回复</th>
                  {priced && <th className="py-1 text-right font-normal">折算 ¥</th>}
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
                    {priced && (
                      <td className="py-1.5 text-right font-mono text-teal-300" title={b.unpriced_msgs > 0 ? `${b.unpriced_msgs} 条模型未定价，未计入` : undefined}>
                        {fmtCny(b.cny)}
                        {b.unpriced_msgs > 0 && <span className="text-amber-400">*</span>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-5 border-t border-zinc-800/60 pt-4 md:grid-cols-3">
            <BucketBars title="本月 · 按模型" entries={sortBuckets(month.by_model)} tone="bg-teal-500" priced={priced} />
            <BucketBars
              title="本月 · 按机器"
              entries={hostEntries}
              tone="bg-violet-500"
              priced={priced}
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
              priced={priced}
            />
          </div>

          <div className="border-t border-zinc-800/60 pt-3 text-xs leading-relaxed">
            <div className="text-zinc-300">{quotaText(data.quota)}</div>
            {data.quota?.detail && <div className="mt-1 text-zinc-600">{data.quota.detail}</div>}
            {pricing ? (
              <div className="mt-2 text-zinc-600">
                金额{pricing.basis ?? "按官方标价折算"}
                {pricing.rules && `；${pricing.rules}`}
                {"；价目来源 "}
                {pricing.sources.length > 0
                  ? pricing.sources.map((src, i) => (
                      <span key={src.url}>
                        {i > 0 && "、"}
                        <a href={src.url} target="_blank" rel="noopener noreferrer" className="text-sky-500 hover:underline">
                          {src.label}
                        </a>
                        {src.fetched_at && `（${src.fetched_at} 抓取）`}
                      </span>
                    ))
                  : "（来源缺失）"}
                {pricing.sources.length > 0 && "，官方调价后需更新"}
                {aliasText && `；${aliasText}`}
                {pricing.warning && <span className="text-amber-400">；{pricing.warning}</span>}
                {pricing.unpriced_models.length > 0 && (
                  <span className="text-amber-400">；未定价模型 {pricing.unpriced_models.join("、")} 不计入金额（标 *）</span>
                )}
              </div>
            ) : (
              <div className="mt-2 text-zinc-600">快照未带价目段，不显示金额</div>
            )}
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
