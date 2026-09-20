/**
 * ClaudeTopicCard — Claude 用量「花在什么事上」卡片（默认收起）。
 *
 * Server component: 读宿主 5min 快照(@/lib/claude-topics)，不在请求里现算
 * （整月要扫 3000+ 个 jsonl，约 10s）。
 *
 * 与 TokenCard 的分工：TokenCard 答「花了多少 / 哪台机 / 哪个模型」(MySQL 流水)；
 * 本卡答「花在哪条战线上」(会话文本归因)。同源同额，整月总额与 DB 逐分钱对齐。
 *
 * 战线口径不是拍脑袋的关键词：来自一次 15-agent workflow 逐条精读全部 797 个任务
 * 归纳的 11 条 workstream，并用那批判读当 ground truth 校准分类器（成本加权 91.1%，
 * 样本内）。11 条互斥且完备，**占比合计恒为 100%**。
 *
 * 陈旧不装新鲜：头部永远显示快照年龄；>15min(连丢 3 跳)转琥珀并标注。
 */
import { Crosshair } from "lucide-react"
import { fetchTopicSnapshot, ageLabel, type Bucket } from "@/lib/claude-topics"
import { WorkstreamNamesEditor } from "./workstream-names-editor"
import { cn } from "@/lib/utils"

function usd(n: number, dp = 0): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })
}

function tokens(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B"
  if (n >= 1e6) return (n / 1e6).toFixed(0) + "M"
  return (n / 1e3).toFixed(0) + "K"
}

/** 模型名压短：claude-fable-5 → Fable 5 */
function modelLabel(id: string): string {
  const m = id.replace(/^claude-/, "")
  const parts = m.split("-")
  const fam = parts.shift() ?? m
  const ver = parts.join(".")
  return fam.charAt(0).toUpperCase() + fam.slice(1) + (ver ? " " + ver : "")
}

const MODEL_TONE: Record<string, string> = {
  fable: "bg-violet-500",
  opus: "bg-sky-500",
  sonnet: "bg-emerald-500",
  haiku: "bg-amber-500",
}
function modelTone(id: string): string {
  const fam = id.replace(/^claude-/, "").split("-")[0]
  return MODEL_TONE[fam] ?? "bg-zinc-500"
}

function ModeBar({
  label,
  bucket,
  total,
  tone,
}: {
  label: string
  bucket: Bucket | undefined
  total: number
  tone: string
}) {
  const cost = bucket?.cost ?? 0
  const pct = total > 0 ? (cost / total) * 100 : 0
  return (
    <div className="flex items-center gap-2.5 text-xs">
      <span className="w-12 flex-shrink-0 text-zinc-400">{label}</span>
      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-800">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-11 flex-shrink-0 text-right font-mono tabular-nums text-zinc-300">
        {pct.toFixed(1)}%
      </span>
      <span className="hidden w-24 flex-shrink-0 text-right font-mono tabular-nums text-zinc-500 sm:inline">
        {usd(cost)} · {bucket?.tasks ?? 0} 个
      </span>
    </div>
  )
}

export async function ClaudeTopicCard() {
  const r = await fetchTopicSnapshot()

  if (!r.ok) {
    return (
      <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4 text-sm">
        <header className="flex items-center gap-2 text-zinc-300">
          <Crosshair className="h-4 w-4 text-zinc-400" />
          <span className="font-medium">Claude 用量归因</span>
        </header>
        <div className="mt-2 text-xs text-rose-400">{r.error}</div>
      </section>
    )
  }

  const { meta, by_mode, by_topic, by_model, by_host } = r.data
  const total = meta.total_cost_usd

  // 全部战线，按成本降序——互斥完备，合计 100%
  const lines = Object.entries(by_topic).sort((a, b) => b[1].cost - a[1].cost)
  const lineMax = lines.length ? lines[0][1].cost : 1
  const lineSum = lines.reduce((s, [, v]) => s + v.cost, 0)

  const models = Object.entries(by_model).sort((a, b) => b[1].cost - a[1].cost)
  const modelMax = models.length ? models[0][1].cost : 1
  const hosts = Object.entries(by_host ?? {}).sort((a, b) => b[1].cost - a[1].cost)

  const subPct = total > 0 ? (meta.subagent_cost_usd / total) * 100 : 0
  const interPct = total > 0 ? ((by_mode.interactive?.cost ?? 0) / total) * 100 : 0

  return (
    <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/40">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 hover:bg-zinc-900/30">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Crosshair className="h-4 w-4 flex-shrink-0 text-sky-400" />
              <span className="text-sm font-medium text-zinc-200">Claude 用量归因</span>
              <span className="text-xs text-zinc-500">花在哪条战线</span>
            </div>
            {/* 收起态只给一行摘要 */}
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-xs text-zinc-500">本月</span>
              <span className="font-mono text-xl tabular-nums text-zinc-100">{usd(total)}</span>
              <span className="font-mono text-xs tabular-nums text-zinc-400">
                {tokens(meta.total_tokens)} token
              </span>
              <span className="font-mono text-xs tabular-nums text-zinc-500">
                {meta.n_tasks.toLocaleString()} 个任务
              </span>
              <span className="font-mono text-xs tabular-nums text-zinc-600">
                我敲的 {interPct.toFixed(0)}% · subagent {subPct.toFixed(0)}%
              </span>
            </div>
            <div className="text-xs text-zinc-500">
              {lines.slice(0, 3).map(([k, v], i) => (
                <span key={k}>
                  {i > 0 && <span className="text-zinc-700"> · </span>}
                  {v.name || k} <span className="font-mono tabular-nums">{usd(v.cost)}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
            <span
              className={cn("text-xs", r.stale ? "text-amber-400" : "text-zinc-600")}
              title={`快照生成于 ${meta.generated_at}（宿主 5 分钟一跳）`}
            >
              {ageLabel(r.ageSeconds)}
              {r.stale && " · 已陈旧"}
            </span>
            <span className="text-xs text-zinc-600">
              <span className="group-open:hidden">全部战线 ▾</span>
              <span className="hidden group-open:inline">收起 ▴</span>
            </span>
          </div>
        </summary>

        <div className="flex flex-col gap-5 px-4 pb-4">
          {/* 全部战线 */}
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-xs font-medium text-zinc-400">
                全部战线（{lines.length} 条，互斥完备）
              </h3>
              <span className="font-mono text-[10px] tabular-nums text-zinc-600">
                合计 {usd(lineSum)} = {total > 0 ? ((lineSum / total) * 100).toFixed(1) : "0"}%
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {lines.map(([k, v]) => (
                <div key={k} className="flex items-center gap-2.5 text-xs">
                  <span className="w-36 flex-shrink-0 truncate text-zinc-300" title={k}>
                    {v.name || k}
                  </span>
                  <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-sky-600/70"
                      style={{ width: `${(v.cost / lineMax) * 100}%` }}
                    />
                  </div>
                  <span className="w-16 flex-shrink-0 text-right font-mono tabular-nums text-zinc-200">
                    {usd(v.cost)}
                  </span>
                  <span className="w-11 flex-shrink-0 text-right font-mono tabular-nums text-zinc-500">
                    {total > 0 ? ((v.cost / total) * 100).toFixed(1) : "0"}%
                  </span>
                  <span className="hidden w-14 flex-shrink-0 text-right font-mono tabular-nums text-zinc-600 sm:inline">
                    {v.tasks} 个
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 按模型：API 额度 + token 量 */}
          <div className="border-t border-zinc-800/60 pt-4">
            <h3 className="mb-2 text-xs font-medium text-zinc-400">
              本月各模型占用（API 标价折算 · token 量）
            </h3>
            <div className="flex flex-col gap-1.5">
              {models.map(([k, v]) => (
                <div key={k} className="flex items-center gap-2.5 text-xs">
                  <span className="flex w-36 flex-shrink-0 items-center gap-2 text-zinc-300" title={k}>
                    <i className={cn("h-2.5 w-2.5 flex-shrink-0 rounded-sm", modelTone(k))} />
                    <span className="truncate">{modelLabel(k)}</span>
                  </span>
                  <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className={cn("h-full rounded-full", modelTone(k))}
                      style={{ width: `${(v.cost / modelMax) * 100}%` }}
                    />
                  </div>
                  <span className="w-16 flex-shrink-0 text-right font-mono tabular-nums text-zinc-200">
                    {usd(v.cost)}
                  </span>
                  <span className="w-11 flex-shrink-0 text-right font-mono tabular-nums text-zinc-500">
                    {total > 0 ? ((v.cost / total) * 100).toFixed(1) : "0"}%
                  </span>
                  <span className="w-14 flex-shrink-0 text-right font-mono tabular-nums text-zinc-400">
                    {tokens(v.tok)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 我敲的 vs cron / 机器 */}
          <div className="grid gap-4 border-t border-zinc-800/60 pt-4 sm:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-medium text-zinc-400">我敲的 vs cron 跑的</h3>
              <div className="flex flex-col gap-1.5">
                <ModeBar label="我敲的" bucket={by_mode.interactive} total={total} tone="bg-sky-500" />
                <ModeBar label="cron" bucket={by_mode.automated} total={total} tone="bg-amber-500" />
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-medium text-zinc-400">按机器</h3>
              <div className="flex flex-col gap-1.5">
                {hosts.map(([k, v]) => (
                  <ModeBar
                    key={k}
                    label={k === "home" ? "家服" : k === "mbp" ? "MBP" : k}
                    bucket={v}
                    total={total}
                    tone={k === "home" ? "bg-emerald-500" : "bg-violet-500"}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* 改名入口：只改显示名 */}
          <div className="border-t border-zinc-800/60 pt-3">
            <WorkstreamNamesEditor order={lines.map(([k]) => k)} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/60 pt-2.5">
            <span className="text-[11px] leading-relaxed text-zinc-600">
              {meta.start.slice(5)} → {meta.end.slice(5)} · 战线口径由 15-agent 逐条精读 797
              个任务归纳，分类器成本加权准确率 91%（样本内）· 成本为 API 标价折算，非订阅实付
            </span>
            <a
              href="/api/claude-topics?format=md"
              className="text-[11px] text-sky-400 hover:text-sky-300 hover:underline"
            >
              看完整报告 →
            </a>
          </div>
        </div>
      </details>
    </section>
  )
}
