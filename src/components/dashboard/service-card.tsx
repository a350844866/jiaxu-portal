"use client"

import * as LucideIcons from "lucide-react"
import { ExternalLink, Wifi } from "lucide-react"
import { cn } from "@/lib/utils"
import { ServiceDefinition, HealthResult } from "@/config/services"
import { StatusDot } from "./status-dot"

interface ServiceCardProps {
  service: ServiceDefinition
  health?: HealthResult
}

function DynamicIcon({ name, className }: { name: string; className?: string }) {
  const Icon = (LucideIcons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[name]
  if (!Icon) {
    const Fallback = LucideIcons.Globe
    return <Fallback className={className} />
  }
  return <Icon className={className} />
}

export function ServiceCard({ service, health }: ServiceCardProps) {
  const status = health?.status ?? "unknown"

  return (
    <a
      href={service.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group relative flex flex-col gap-3 rounded-xl border p-4 transition-all duration-200",
        "bg-zinc-900/60 backdrop-blur-sm",
        "hover:bg-zinc-800/80 hover:shadow-lg hover:-translate-y-0.5",
        service.isOwn
          ? "border-emerald-800/50 hover:border-emerald-600/60 hover:shadow-emerald-950/40"
          : "border-zinc-800 hover:border-zinc-600/60 hover:shadow-zinc-950/40"
      )}
    >
      {/* Status dot top-right */}
      <div className="absolute top-3 right-3">
        <StatusDot status={status} />
      </div>

      {/* Icon + Name */}
      <div className="flex items-center gap-3 pr-4">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            service.isOwn
              ? "bg-emerald-950/60 text-emerald-400"
              : "bg-zinc-800 text-zinc-300"
          )}
        >
          <DynamicIcon name={service.icon} className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-zinc-100 truncate">
              {service.name}
            </span>
            <ExternalLink className="h-3 w-3 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-zinc-500 leading-relaxed line-clamp-2">
        {service.description}
      </p>

      {/* Footer */}
      <div className="flex items-center justify-between mt-auto pt-1">
        {service.internalOnly ? (
          <span className="flex items-center gap-1 text-[10px] text-amber-600/70">
            <Wifi className="h-3 w-3" />
            仅内网
          </span>
        ) : (
          <span className="text-[10px] text-zinc-600 truncate">
            {new URL(service.url).hostname}
          </span>
        )}
        {health?.responseTimeMs != null && status === "up" && (
          <span className="text-[10px] text-zinc-600">
            {health.responseTimeMs}ms
          </span>
        )}
      </div>
    </a>
  )
}
