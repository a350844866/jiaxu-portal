"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

/**
 * The page is a server component reading files that the watcher rewrites every
 * 10s, so a reload always shows current state — but nothing reloads on its own.
 * This ticks router.refresh() so an open tab actually tracks the account.
 *
 * Pauses while the tab is hidden: a background tab re-rendering the whole
 * dashboard every 15s is pure waste.
 */
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter()
  const [last, setLast] = useState<number>(() => Date.now())

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return
      router.refresh()
      setLast(Date.now())
    }
    const id = setInterval(tick, seconds * 1000)
    const onVisible = () => {
      if (document.visibilityState === "visible") tick()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [router, seconds])

  return (
    <span className="text-[11px] text-zinc-600" suppressHydrationWarning>
      每 {seconds}s 自动刷新 · 上次 {new Date(last).toLocaleTimeString("zh-CN", { hour12: false })}
    </span>
  )
}
