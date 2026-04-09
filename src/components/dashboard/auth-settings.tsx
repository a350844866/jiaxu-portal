"use client"

import { useState, useEffect, useCallback } from "react"
import { Settings, X, Shield, ShieldOff, Loader2 } from "lucide-react"

interface ProxyHost {
  id: number
  domains: string[]
  forwardPort: number
  accessListId: number
  sslForced: boolean
  enabled: boolean
}

export function AuthSettings() {
  const [open, setOpen] = useState(false)
  const [hosts, setHosts] = useState<ProxyHost[]>([])
  const [loading, setLoading] = useState(false)
  const [toggling, setToggling] = useState<number | null>(null)
  const [error, setError] = useState("")

  const fetchHosts = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/npm/proxy-hosts")
      if (!res.ok) throw new Error(`${res.status}`)
      const data: ProxyHost[] = await res.json()
      // Sort: authed first, then by domain name
      data.sort((a, b) => {
        if (a.accessListId && !b.accessListId) return -1
        if (!a.accessListId && b.accessListId) return 1
        return a.domains[0].localeCompare(b.domains[0])
      })
      setHosts(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) fetchHosts()
  }, [open, fetchHosts])

  async function toggleAuth(host: ProxyHost) {
    setToggling(host.id)
    try {
      const res = await fetch(`/api/npm/proxy-hosts/${host.id}/auth`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !host.accessListId }),
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const updated = await res.json()
      setHosts((prev) =>
        prev.map((h) =>
          h.id === host.id ? { ...h, accessListId: updated.accessListId } : h
        )
      )
    } catch {
      setError("切换失败，请重试")
    } finally {
      setToggling(null)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
        title="认证设置"
      >
        <Settings className="h-4.5 w-4.5" />
      </button>

      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Side panel */}
      <div
        className={`fixed top-0 right-0 z-50 h-full w-full max-w-md transform transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="h-full bg-zinc-900 border-l border-zinc-800 flex flex-col">
          {/* Panel header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-zinc-400" />
              <h2 className="text-sm font-medium text-zinc-200">
                Basic Auth 管理
              </h2>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-zinc-500 hover:text-zinc-300"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <p className="px-5 py-3 text-xs text-zinc-500 border-b border-zinc-800/50">
            通过 NPM Access List 控制各服务的 Basic Auth。开启后公网访问需要输入用户名密码。
          </p>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-5 py-3">
            {loading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 text-zinc-500 animate-spin" />
              </div>
            )}

            {error && (
              <div className="text-xs text-red-400 bg-red-950/30 rounded-lg px-3 py-2 mb-3">
                {error}
              </div>
            )}

            {!loading && hosts.length > 0 && (
              <div className="space-y-1">
                {hosts.map((host) => {
                  const domain = host.domains[0] || "unknown"
                  const hasAuth = host.accessListId > 0
                  const isBusy = toggling === host.id

                  return (
                    <div
                      key={host.id}
                      className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-zinc-800/50 transition-colors group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {hasAuth ? (
                          <Shield className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        ) : (
                          <ShieldOff className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
                        )}
                        <span className="text-xs text-zinc-300 truncate">
                          {domain}
                        </span>
                      </div>
                      <button
                        onClick={() => toggleAuth(host)}
                        disabled={isBusy}
                        className={`relative shrink-0 h-5 w-9 rounded-full transition-colors ${
                          hasAuth
                            ? "bg-emerald-600"
                            : "bg-zinc-700"
                        } ${isBusy ? "opacity-50" : ""}`}
                      >
                        {isBusy ? (
                          <Loader2 className="absolute top-0.5 left-2 h-4 w-4 text-white animate-spin" />
                        ) : (
                          <span
                            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                              hasAuth ? "left-[18px]" : "left-0.5"
                            }`}
                          />
                        )}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {!loading && !error && hosts.length === 0 && (
              <div className="text-center py-12 text-xs text-zinc-500">
                未找到 Proxy Host
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
