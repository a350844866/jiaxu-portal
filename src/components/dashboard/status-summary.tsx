"use client"

import { HealthResult } from "@/config/services"

interface StatusSummaryProps {
  results: HealthResult[]
}

export function StatusSummary({ results }: StatusSummaryProps) {
  const total = results.length
  const up = results.filter((r) => r.status === "up").length
  const down = results.filter((r) => r.status === "down").length
  const allGood = down === 0

  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-2.5">
      <div
        className={`h-2 w-2 rounded-full ${allGood ? "bg-emerald-500" : "bg-red-500"}`}
      />
      <span className="text-sm text-zinc-300">
        {up} / {total} 服务在线
      </span>
      {down > 0 && (
        <span className="text-sm text-red-400">{down} 个异常</span>
      )}
    </div>
  )
}
