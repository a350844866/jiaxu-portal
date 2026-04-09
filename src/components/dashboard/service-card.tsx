"use client"

import * as LucideIcons from "lucide-react"
import { ExternalLink, Wifi, WifiOff, Eye, EyeOff } from "lucide-react"
import { cn } from "@/lib/utils"
import { ServiceDefinition, HealthResult, getInternalUrl } from "@/config/services"
import { StatusDot } from "./status-dot"
import type { NetworkMode } from "@/hooks/use-network-mode"

interface ServiceCardProps {
  service: ServiceDefinition
  health?: HealthResult
  networkMode: NetworkMode
  editing?: boolean
  hidden?: boolean
  onToggleHidden?: () => void
}

function DynamicIcon({ name, className }: { name: string; className?: string }) {
  const Icon = (LucideIcons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[name]
  if (!Icon) {
    const Fallback = LucideIcons.Globe
    return <Fallback className={className} />
  }
  return <Icon className={className} />
}

export function ServiceCard({ service, health, networkMode, editing, hidden, onToggleHidden }: ServiceCardProps) {
  const status = health?.status ?? "unknown"
  const isExternal = networkMode === "external"
  const unreachable = isExternal && service.internalOnly

  const href = unreachable || editing
    ? undefined
    : networkMode === "internal"
      ? getInternalUrl(service)
      : service.url

  const Tag = unreachable || editing ? "div" : "a"
  const linkProps = unreachable || editing
    ? {}
    : { href, target: "_blank" as const, rel: "noopener noreferrer" }

  return (
    <Tag
      {...linkProps}
      className={cn(
        "group relative flex flex-col gap-3 rounded-xl border p-4 transition-all duration-200",
        "bg-zinc-900/60 backdrop-blur-sm",
        editing && hidden && "opacity-40",
        unreachable && !editing
          ? "border-zinc-800/50 opacity-45 cursor-not-allowed"
          : !editing && "hover:bg-zinc-800/80 hover:shadow-lg hover:-translate-y-0.5",
        !unreachable && !editing && service.isOwn
          ? "border-emerald-800/50 hover:border-emerald-600/60 hover:shadow-emerald-950/40"
          : !unreachable && !editing
            ? "border-zinc-800 hover:border-zinc-600/60 hover:shadow-zinc-950/40"
            : "",
        editing && "border-zinc-700 cursor-pointer"
      )}
      onClick={editing ? onToggleHidden : undefined}
    >
      {/* Edit mode: visibility toggle */}
      {editing && (
        <div className="absolute top-3 right-3 z-10">
          {hidden ? (
            <EyeOff className="h-4 w-4 text-zinc-500" />
          ) : (
            <Eye className="h-4 w-4 text-emerald-400" />
          )}
        </div>
      )}

      {/* Status dot top-right (hidden in edit mode) */}
      {!editing && (
        <div className="absolute top-3 right-3">
          <StatusDot status={status} />
        </div>
      )}

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
            {!unreachable && (
              <ExternalLink className="h-3 w-3 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            )}
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-zinc-500 leading-relaxed line-clamp-2">
        {service.description}
      </p>

      {/* Footer */}
      <div className="flex items-center justify-between mt-auto pt-1">
        {unreachable ? (
          <span className="flex items-center gap-1 text-[10px] text-red-500/70">
            <WifiOff className="h-3 w-3" />
            外网不可达
          </span>
        ) : service.internalOnly ? (
          <span className="flex items-center gap-1 text-[10px] text-amber-600/70">
            <Wifi className="h-3 w-3" />
            仅内网
          </span>
        ) : (
          <span className="text-[10px] text-zinc-600 truncate">
            {service.url.startsWith("/")
              ? "portal-proxy"
              : networkMode === "internal"
                ? getInternalUrl(service).replace(/^https?:\/\//, "")
                : new URL(service.url).hostname}
          </span>
        )}
        {health?.responseTimeMs != null && status === "up" && (
          <span className="text-[10px] text-zinc-600">
            {health.responseTimeMs}ms
          </span>
        )}
      </div>
    </Tag>
  )
}
