"use client"

import { useEffect, useState } from "react"
import { Server } from "lucide-react"
import { AuthSettings } from "@/components/dashboard/auth-settings"

export function Header() {
  const [time, setTime] = useState("")

  useEffect(() => {
    const fmt = () => {
      const now = new Date()
      setTime(
        now.toLocaleString("zh-CN", {
          weekday: "short",
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        })
      )
    }
    fmt()
    const id = setInterval(fmt, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <header className="flex items-center justify-between py-6">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-800 text-zinc-300">
          <Server className="h-4.5 w-4.5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-zinc-100 leading-tight">
            Jiaxu Portal
          </h1>
          <p className="text-xs text-zinc-500">jiaxu-server-home</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {time && (
          <span className="hidden sm:block text-sm text-zinc-500 tabular-nums">
            {time}
          </span>
        )}
        <AuthSettings />
      </div>
    </header>
  )
}
