"use client"

import { useState, useEffect, useCallback } from "react"
import { createPortal } from "react-dom"
import {
  FileText,
  Save,
  Loader2,
  RefreshCw,
  Plus,
  Trash2,
  X,
  Code,
  List,
} from "lucide-react"

// ── Types ──

const RULE_TYPES = [
  { value: "DOMAIN-SUFFIX", label: "域名后缀", placeholder: "example.com", group: "domain" },
  { value: "DOMAIN", label: "完整域名", placeholder: "www.example.com", group: "domain" },
  { value: "DOMAIN-KEYWORD", label: "域名关键字", placeholder: "google", group: "domain" },
  { value: "IP-CIDR", label: "IPv4 CIDR", placeholder: "192.168.1.0/24", group: "ip" },
  { value: "IP-CIDR6", label: "IPv6 CIDR", placeholder: "2001:db8::/32", group: "ip" },
  { value: "GEOIP", label: "GeoIP", placeholder: "CN", group: "ip" },
  { value: "URL-REGEX", label: "URL 正则", placeholder: "^https?://example\\.com", group: "other" },
] as const

type RuleType = (typeof RULE_TYPES)[number]["value"]

interface ParsedRule {
  type: RuleType | string
  value: string
  noResolve: boolean
  raw: string
}

function parseRules(text: string): ParsedRule[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const parts = line.split(",")
      const type = parts[0] || ""
      const value = parts[1] || ""
      const noResolve = parts.some((p) => p.trim().toLowerCase() === "no-resolve")
      return { type, value, noResolve, raw: line }
    })
}

function buildRuleLine(type: string, value: string, noResolve: boolean): string {
  const isIp = type === "IP-CIDR" || type === "IP-CIDR6" || type === "GEOIP"
  if (isIp && noResolve) {
    return `${type},${value},no-resolve`
  }
  return `${type},${value}`
}

// ── Add Rule Dialog ──

function AddRuleDialog({
  onAdd,
  onClose,
}: {
  onAdd: (rule: ParsedRule) => void
  onClose: () => void
}) {
  const [type, setType] = useState<string>("DOMAIN-SUFFIX")
  const [value, setValue] = useState("")
  const [noResolve, setNoResolve] = useState(false)

  const typeInfo = RULE_TYPES.find((t) => t.value === type)
  const isIp = typeInfo?.group === "ip"
  const preview = value ? buildRuleLine(type, value, isIp && noResolve) : ""

  function handleAdd() {
    if (!value.trim()) return
    const raw = buildRuleLine(type, value.trim(), isIp && noResolve)
    onAdd({ type, value: value.trim(), noResolve: isIp && noResolve, raw })
    onClose()
  }

  return createPortal(
    <>
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div
          className="w-full max-w-sm max-h-[calc(100vh-2rem)] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
            <span className="text-sm font-medium text-zinc-200">添加规则</span>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-4 space-y-4 overflow-y-auto flex-1 min-h-0">
            {/* Rule type */}
            <div>
              <label className="block text-xs text-zinc-500 mb-1.5">规则类型</label>
              <select
                value={type}
                onChange={(e) => { setType(e.target.value); setNoResolve(false) }}
                className="w-full h-9 rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
              >
                <optgroup label="域名">
                  {RULE_TYPES.filter((t) => t.group === "domain").map((t) => (
                    <option key={t.value} value={t.value}>{t.label} ({t.value})</option>
                  ))}
                </optgroup>
                <optgroup label="IP">
                  {RULE_TYPES.filter((t) => t.group === "ip").map((t) => (
                    <option key={t.value} value={t.value}>{t.label} ({t.value})</option>
                  ))}
                </optgroup>
                <optgroup label="其他">
                  {RULE_TYPES.filter((t) => t.group === "other").map((t) => (
                    <option key={t.value} value={t.value}>{t.label} ({t.value})</option>
                  ))}
                </optgroup>
              </select>
            </div>

            {/* Value */}
            <div>
              <label className="block text-xs text-zinc-500 mb-1.5">值</label>
              <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={typeInfo?.placeholder}
                className="w-full h-9 rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 font-mono"
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              />
            </div>

            {/* no-resolve toggle (IP types only) */}
            {isIp && (
              <label className="flex items-center gap-2 cursor-pointer">
                <button
                  type="button"
                  onClick={() => setNoResolve(!noResolve)}
                  className={`relative h-5 w-9 rounded-full transition-colors ${
                    noResolve ? "bg-emerald-600" : "bg-zinc-700"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                      noResolve ? "left-[18px]" : "left-0.5"
                    }`}
                  />
                </button>
                <span className="text-xs text-zinc-400">no-resolve</span>
              </label>
            )}

            {/* Preview */}
            {preview && (
              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">预览</label>
                <code className="block text-xs text-emerald-400 bg-zinc-800 rounded-lg px-3 py-2 font-mono">
                  {preview}
                </code>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-800 shrink-0">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleAdd}
              disabled={!value.trim()}
              className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <Plus className="h-3 w-3" />
              添加
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  )
}

// ── Main Editor ──

interface RuleFile {
  name: string
  content: string
}

export function SurgeRuleEditor() {
  const [files, setFiles] = useState<string[]>([])
  const [active, setActive] = useState<RuleFile | null>(null)
  const [draft, setDraft] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState("")
  const [mode, setMode] = useState<"visual" | "raw">("visual")
  const [showAddDialog, setShowAddDialog] = useState(false)

  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch("/api/surge-rules")
      if (!res.ok) return
      const data = await res.json()
      setFiles(data.files || [])
    } catch {}
  }, [])

  useEffect(() => { fetchFiles() }, [fetchFiles])

  async function loadFile(name: string) {
    setLoading(true)
    setMsg("")
    try {
      const res = await fetch(`/api/surge-rules?file=${encodeURIComponent(name)}`)
      if (!res.ok) throw new Error("加载失败")
      const data = await res.json()
      setActive({ name: data.file, content: data.content })
      setDraft(data.content)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }

  async function saveFile() {
    if (!active) return
    setSaving(true)
    setMsg("")
    try {
      const res = await fetch("/api/surge-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: active.name, content: draft }),
      })
      if (!res.ok) throw new Error("保存失败")
      setActive({ ...active, content: draft })
      setMsg("已保存")
      setTimeout(() => setMsg(""), 2000)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  // Auto-load first file
  useEffect(() => {
    if (files.length > 0 && !active) loadFile(files[0])
  }, [files, active])

  const dirty = active ? draft !== active.content : false
  const rules = parseRules(draft)

  function addRule(rule: ParsedRule) {
    const trimmed = draft.trimEnd()
    setDraft(trimmed ? trimmed + "\n" + rule.raw + "\n" : rule.raw + "\n")
  }

  function deleteRule(index: number) {
    const lines = draft.split("\n")
    // Find the actual line index (skip empty lines and comments)
    let ruleIdx = 0
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line || line.startsWith("#")) continue
      if (ruleIdx === index) {
        lines.splice(i, 1)
        setDraft(lines.join("\n"))
        return
      }
      ruleIdx++
    }
  }

  function getRuleTypeColor(type: string): string {
    if (type.startsWith("DOMAIN")) return "text-blue-400 bg-blue-950/40"
    if (type.startsWith("IP") || type === "GEOIP") return "text-amber-400 bg-amber-950/40"
    return "text-purple-400 bg-purple-950/40"
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-200">Surge 规则编辑</span>
        </div>
        <div className="flex items-center gap-2">
          {msg && (
            <span className={`text-xs ${msg.includes("失败") ? "text-red-400" : "text-emerald-400"}`}>
              {msg}
            </span>
          )}

          {/* Mode toggle */}
          <div className="flex rounded-md border border-zinc-700 overflow-hidden">
            <button
              onClick={() => setMode("visual")}
              className={`px-2 py-1 text-xs flex items-center gap-1 transition-colors ${
                mode === "visual" ? "bg-zinc-700 text-zinc-200" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <List className="h-3 w-3" />
              可视化
            </button>
            <button
              onClick={() => setMode("raw")}
              className={`px-2 py-1 text-xs flex items-center gap-1 transition-colors ${
                mode === "raw" ? "bg-zinc-700 text-zinc-200" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Code className="h-3 w-3" />
              Raw
            </button>
          </div>

          <button
            onClick={() => active && loadFile(active.name)}
            disabled={loading}
            className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            title="刷新"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={saveFile}
            disabled={saving || !dirty}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              dirty
                ? "bg-emerald-600 text-white hover:bg-emerald-500"
                : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
            }`}
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            保存
          </button>
        </div>
      </div>

      {/* File tabs */}
      {files.length > 1 && (
        <div className="flex gap-1 px-4 py-2 border-b border-zinc-800/50 overflow-x-auto">
          {files.map((f) => (
            <button
              key={f}
              onClick={() => loadFile(f)}
              className={`px-2.5 py-1 rounded text-xs whitespace-nowrap transition-colors ${
                active?.name === f
                  ? "bg-zinc-700 text-zinc-200"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/80 z-10">
            <Loader2 className="h-5 w-5 text-zinc-500 animate-spin" />
          </div>
        )}

        {mode === "visual" ? (
          <div className="min-h-[192px] max-h-[400px] overflow-y-auto">
            {rules.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-xs text-zinc-600">
                暂无规则
              </div>
            ) : (
              <div className="divide-y divide-zinc-800/50">
                {rules.map((rule, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-4 py-2 hover:bg-zinc-800/30 transition-colors group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono ${getRuleTypeColor(rule.type)}`}
                      >
                        {rule.type}
                      </span>
                      <span className="text-xs text-zinc-300 font-mono truncate">
                        {rule.value}
                      </span>
                      {rule.noResolve && (
                        <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-500">
                          no-resolve
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => deleteRule(i)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-zinc-600 hover:text-red-400 transition-all"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add button */}
            <div className="px-4 py-3">
              <button
                onClick={() => setShowAddDialog(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-zinc-700 text-xs text-zinc-500 hover:text-zinc-300 hover:border-zinc-500 transition-colors w-full justify-center"
              >
                <Plus className="h-3 w-3" />
                添加规则
              </button>
            </div>
          </div>
        ) : (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="w-full h-48 px-4 py-3 bg-transparent text-xs text-zinc-300 font-mono leading-relaxed resize-y focus:outline-none placeholder:text-zinc-600"
            placeholder="# Surge Rule List..."
          />
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-zinc-800/50 flex items-center justify-between">
        <span className="text-[10px] text-zinc-600">
          {rules.length} 条规则
        </span>
        <span className="text-[10px] text-zinc-600">
          /surge-rules/{active?.name || "..."}
        </span>
      </div>

      {/* Add dialog */}
      {showAddDialog && (
        <AddRuleDialog onAdd={addRule} onClose={() => setShowAddDialog(false)} />
      )}
    </div>
  )
}
