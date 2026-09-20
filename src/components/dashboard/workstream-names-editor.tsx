"use client"

/**
 * 战线显示名内联编辑器（Claude 用量归因卡片展开区）。
 *
 * 只改**名字**——不改归类、不改金额。保存后写 /data/ws-names/workstream-names.conf，
 * 家服快照 timer ≤5 分钟读到，卡片随之更新（所以保存成功后提示的是「≤5 分钟生效」，
 * 不假装立即刷新——立即改 DOM 会让人以为已生效，实际卡片数据还是旧快照）。
 */
import { useState } from "react"
import { Pencil, Check, X, RotateCcw, Loader2 } from "lucide-react"

type Props = {
  /** 展示顺序（按成本降序，与卡片一致）。打开编辑器后一律以接口返回的 ids 为准 */
  order: string[]
}

export function WorkstreamNamesEditor({ order }: Props) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [baseline, setBaseline] = useState<Record<string, string>>({})
  const [ids, setIds] = useState<string[]>(order)
  const [revision, setRevision] = useState<string | null>(null)
  const [defaults, setDefaults] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null)

  async function start() {
    setOpen(true)
    setMsg(null)
    try {
      const r = await fetch("/api/claude-topics/names", { cache: "no-store" })
      const j = await r.json()
      if (!r.ok || j?.editable === false) {
        setMsg({ kind: "err", text: j?.error || "暂时无法编辑" })
        return
      }
      setDefaults(j.defaults ?? {})
      setIds(j.ids ?? [])
      setRevision(j.revision ?? null)
      // ⚠ 只用**盘上真实的覆盖值**填 draft，缺失的留空。
      // 绝不用 defaults 预填 —— 那样一次保存就会把 11 个默认名全部钉成显式覆盖，
      // 以后改内置默认名再也传不下来（Codex 审查 finding 2）。空 = 跟随默认。
      setBaseline(j.current ?? {})
      setDraft(j.current ?? {})
    } catch {
      setMsg({ kind: "err", text: "拉取当前配置失败" })
    }
  }

  async function save() {
    // 只提交与盘上基线不同的项：未改动的战线不写入配置，继续跟随内置默认名
    const changed: Record<string, string> = {}
    for (const id of ids) {
      const now = (draft[id] ?? "").trim()
      const was = (baseline[id] ?? "").trim()
      if (now !== was) changed[id] = now // "" 表示删除覆盖 → 回落默认
    }
    if (!Object.keys(changed).length) {
      setMsg({ kind: "ok", text: "没有改动" })
      setOpen(false)
      return
    }
    setSaving(true)
    setMsg(null)
    try {
      const r = await fetch("/api/claude-topics/names", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names: changed, base_revision: revision ?? "" }),
      })
      const j = await r.json()
      if (r.status === 409) {
        setMsg({ kind: "err", text: "配置已被别处改动，请取消后重新打开合并" })
        return
      }
      if (!r.ok) {
        setMsg({ kind: "err", text: j?.error || `保存失败 (${r.status})` })
        return
      }
      const n = Object.keys(changed).length
      const extra = j?.sanitized?.length ? `，${j.sanitized.length} 个含非法字符已清理` : ""
      setMsg({ kind: "ok", text: `已写入 ${n} 项${extra}；等快照应用（≤5 分钟）后卡片更新` })
      setOpen(false)
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "网络错误" })
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={start}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800/60 hover:text-zinc-100"
        >
          <Pencil className="h-3 w-3" />
          改战线名字
        </button>
        {msg && (
          <span className={msg.kind === "ok" ? "text-[11px] text-emerald-400" : "text-[11px] text-rose-400"}>
            {msg.text}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-zinc-700/70 bg-zinc-900/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-zinc-300">改战线名字</span>
        <span className="text-[10px] text-zinc-500">只改显示名，不影响归类和金额</span>
      </div>

      <div className="flex flex-col gap-1.5">
        {ids.map((id) => (
          <div key={id} className="flex items-center gap-2">
            <code className="w-40 flex-shrink-0 truncate font-mono text-[10px] text-zinc-500" title={id}>
              {id}
            </code>
            <input
              value={draft[id] ?? ""}
              maxLength={40}
              onChange={(e) => setDraft({ ...draft, [id]: e.target.value })}
              placeholder={defaults[id] ?? id}
              className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950/60 px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-sky-600 focus:outline-none"
            />
            <button
              type="button"
              title="恢复默认名（清空该项覆盖）"
              onClick={() => setDraft({ ...draft, [id]: "" })}
              className="flex-shrink-0 rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          保存
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setMsg(null)
          }}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800/60 disabled:opacity-50"
        >
          <X className="h-3 w-3" />
          取消
        </button>
        <span className="text-[10px] text-zinc-500">留空 = 恢复默认名</span>
        {msg && (
          <span className={msg.kind === "ok" ? "text-[11px] text-emerald-400" : "text-[11px] text-rose-400"}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  )
}
