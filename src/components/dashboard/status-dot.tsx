"use client"

import { cn } from "@/lib/utils"

type Status = "up" | "down" | "unknown"

interface StatusDotProps {
  status: Status
  showLabel?: boolean
}

const statusConfig = {
  up: { color: "bg-emerald-500", label: "在线", pulse: true },
  down: { color: "bg-red-500", label: "离线", pulse: false },
  unknown: { color: "bg-zinc-500", label: "未知", pulse: false },
}

export function StatusDot({ status, showLabel = false }: StatusDotProps) {
  const config = statusConfig[status]
  return (
    <span className="flex items-center gap-1.5">
      <span className="relative flex h-2 w-2">
        {config.pulse && (
          <span
            className={cn(
              "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
              config.color
            )}
          />
        )}
        <span
          className={cn(
            "relative inline-flex rounded-full h-2 w-2",
            config.color
          )}
        />
      </span>
      {showLabel && (
        <span className="text-xs text-zinc-400">{config.label}</span>
      )}
    </span>
  )
}
