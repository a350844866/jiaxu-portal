/**
 * TodoCard — surfaces the vault's TODO.md on the portal main page.
 *
 * Server component: reads /data/vault/TODO.md at request time (page is
 * `revalidate = 30`, so the latest content shows within 30s of a vault edit).
 * Items are grouped by system tag; bucket (short/mid) shown as a chip.
 *
 * "Done" + "long/Phase 5" items are dropped from the card to keep noise low —
 * homepage only surfaces actionable / near-term work. Phase 5 long-term items
 * live in vault/TODO.md "## 长期 / Phase 5 留扩展点" section; read directly
 * when planning roadmap.
 */
import {
  readTodoSnapshot,
  groupBySystem,
  SYSTEM_LABELS,
  BUCKET_LABELS,
  type TodoItem,
} from "@/lib/todo-reader"
import { ListTodo } from "lucide-react"
import { cn } from "@/lib/utils"

const BUCKET_ORDER: Record<TodoItem["bucket"], number> = {
  short: 0, mid: 1, long: 2, unknown: 3, done: 4,
}

function sortItems(a: TodoItem, b: TodoItem): number {
  const ba = BUCKET_ORDER[a.bucket] ?? 99
  const bb = BUCKET_ORDER[b.bucket] ?? 99
  if (ba !== bb) return ba - bb
  // Within same bucket, oldest "added" first (longest-pending floats up)
  const da = a.added ?? "9999-99-99"
  const db = b.added ?? "9999-99-99"
  return da.localeCompare(db)
}

const SYSTEM_ORDER = [
  "mt5", "mt4", "mt4-mt5", "ibkr", "quant-flow",
  "jiaxu-portal", "home-server", "wiki", "meta",
]

/**
 * 已停用 / 冻结项目的组（2026-09-28）：条目仍在 TODO.md 里等解冻，但首页默认折叠成一行、排到最后。
 * 此前 quant-flow（06-07 kill-switch 起冻结）6 条长条目整段铺开，占了卡片大半屏。
 * 项目解冻时把它从这里删掉即可。
 */
const FROZEN_SYSTEMS = new Set(["quant-flow", "mt4", "mt5", "mt4-mt5"])

function systemRank(s: string): number {
  if (FROZEN_SYSTEMS.has(s)) return 10_000
  const i = SYSTEM_ORDER.indexOf(s)
  return i === -1 ? 999 : i
}

export async function TodoCard() {
  const snap = await readTodoSnapshot()

  if (!snap.ok) {
    return (
      <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4 text-sm text-zinc-400">
        <div className="flex items-center gap-2 text-zinc-300">
          <ListTodo className="h-4 w-4" />
          <span className="font-medium">待办</span>
        </div>
        <div className="mt-2 text-xs text-rose-400">读 TODO.md 失败:{snap.error}</div>
      </section>
    )
  }

  // Drop done + long(Phase 5) items from the card display.
  // - done: kept in file for 1 month archival per CLAUDE §13.4
  // - long: Phase 5 远期项,首页不该浮上来当噪声;在 TODO.md 文件内可直接读
  const open = snap.items.filter(
    (i) => !i.done && i.bucket !== "done" && i.bucket !== "long",
  )
  const grouped = groupBySystem(open)

  // Sort systems by predefined order then alpha
  const systems = Array.from(grouped.keys()).sort((a, b) => {
    const ra = systemRank(a), rb = systemRank(b)
    if (ra !== rb) return ra - rb
    return a.localeCompare(b)
  })

  const total = open.length

  return (
    <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/40">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between p-4 hover:bg-zinc-900/30">
          <div className="flex items-center gap-2">
            <ListTodo className="h-4 w-4 text-zinc-300" />
            <span className="text-sm font-medium text-zinc-200">待办</span>
            <span className="text-xs text-zinc-500">{total} 项</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span>
              来源:<code className="text-zinc-400">vault/TODO.md</code>
              {snap.ageSeconds !== null && (
                <span className="ml-2">更新于 {fmtAge(snap.ageSeconds)}</span>
              )}
            </span>
            <span className="text-zinc-600 group-open:hidden">展开 ▾</span>
            <span className="hidden text-zinc-600 group-open:inline">收起 ▴</span>
          </div>
        </summary>

      {total === 0 ? (
        <div className="px-4 pb-4 text-sm text-zinc-500">没有待办 — 想加 → 编辑 vault/TODO.md</div>
      ) : (
        <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-3">
          {systems.map((sys) => {
            const items = grouped.get(sys)!.slice().sort(sortItems)
            const meta = SYSTEM_LABELS[sys] ?? {
              label: sys,
              tone: "border-zinc-500/30 bg-zinc-500/5 text-zinc-200",
            }
            if (FROZEN_SYSTEMS.has(sys)) {
              return (
                <details
                  key={sys}
                  className="group/frozen rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-zinc-500"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between text-xs">
                    <span className="font-medium uppercase tracking-wide">
                      {meta.label} <span className="normal-case text-zinc-600">· 项目已冻结</span>
                    </span>
                    <span className="text-[10px] text-zinc-600">
                      {items.length} 条 <span className="group-open/frozen:hidden">▾</span>
                      <span className="hidden group-open/frozen:inline">▴</span>
                    </span>
                  </summary>
                  <ul className="mt-2 space-y-1.5 text-[11px]">
                    {items.map((it, idx) => (
                      <li key={idx} className="line-clamp-2 leading-relaxed text-zinc-400">
                        {it.description}
                      </li>
                    ))}
                  </ul>
                </details>
              )
            }
            return (
              <div
                key={sys}
                className={cn("rounded-xl border bg-zinc-950/60 p-3", meta.tone)}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide">
                    {meta.label}
                  </span>
                  <span className="text-[10px] text-zinc-500">{items.length}</span>
                </div>
                <ul className="mt-2 space-y-2 text-xs">
                  {items.map((it, idx) => (
                    <li key={idx} className="leading-relaxed">
                      <div className="flex items-start gap-1.5">
                        <span className="mt-1 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-current opacity-60" />
                        <div className="min-w-0">
                          <span className="text-zinc-100">{it.description}</span>
                          <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] text-zinc-500">
                            <span className="rounded border border-zinc-700/60 px-1">
                              {BUCKET_LABELS[it.bucket]}
                            </span>
                            {it.added && <span>· {it.added}</span>}
                          </span>
                          {it.subBullets.length > 0 && (
                            <ul className="ml-2 mt-1 list-disc space-y-0.5 pl-3 text-[11px] text-zinc-400">
                              {it.subBullets.slice(0, 3).map((s, i) => (
                                <li key={i}>{s}</li>
                              ))}
                              {it.subBullets.length > 3 && (
                                <li className="text-zinc-600">
                                  …{it.subBullets.length - 3} 条更多(看 vault)
                                </li>
                              )}
                            </ul>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
      </details>
    </section>
  )
}

function fmtAge(sec: number): string {
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}min`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`
  return `${Math.floor(sec / 86400)}d`
}
