"use client"

import { useMemo } from "react"
import { ServiceDefinition, HealthResult } from "@/config/services"
import { categories } from "@/config/categories-data"
import { ServiceCard } from "./service-card"
import { SearchBar } from "./search-bar"
import { StatusSummary } from "./status-summary"
import { CronJobsBlock } from "./cron-jobs-block"
import { useServiceFilter } from "@/hooks/use-service-filter"
import { useNetworkMode } from "@/hooks/use-network-mode"
import { useHealthPolling } from "@/hooks/use-health-polling"
import { useHiddenServices } from "@/hooks/use-hidden-services"
import { iconMap } from "@/lib/icon-map"
import { Pencil, Check } from "lucide-react"
import { SurgeRuleEditor } from "./surge-rule-editor"
import { LogHealthCard } from "./log-health-card"
import { FeErrorCard } from "./fe-error-card"

interface ServiceGridProps {
  services: ServiceDefinition[]
  initialHealth: HealthResult[]
}

function CategoryIcon({ name }: { name: string }) {
  const Icon = iconMap[name]
  if (!Icon) return null
  return <Icon className="h-4 w-4 text-zinc-400" />
}

export function ServiceGrid({ services, initialHealth }: ServiceGridProps) {
  const { query, setQuery, filtered } = useServiceFilter(services)
  const networkMode = useNetworkMode()
  const health = useHealthPolling(initialHealth)
  const { editing, setEditing, toggle, isHidden } = useHiddenServices()

  const healthMap = useMemo(
    () => Object.fromEntries(health.map((h) => [h.id, h])),
    [health]
  )

  // In editing mode show all services; otherwise filter out hidden ones
  const visible = useMemo(
    () => (editing ? filtered : filtered.filter((s) => !isHidden(s.id))),
    [filtered, editing, isHidden]
  )

  const grouped = useMemo(() => {
    return categories
      .map((cat) => ({
        cat,
        items: visible.filter((s) => s.category === cat.id),
      }))
      .filter((g) => g.items.length > 0)
  }, [visible])

  return (
    <div className="space-y-8">
      {/* Live status summary + 宿主机定时任务 */}
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start">
        <StatusSummary results={health} />
        <div className="min-w-0 flex-1">
          <CronJobsBlock />
        </div>
      </div>

      {/* Search bar + edit toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-600">
            {networkMode === "internal" ? "内网模式" : "外网模式"}
          </span>
          <button
            onClick={() => setEditing(!editing)}
            className={
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors " +
              (editing
                ? "bg-emerald-900/60 text-emerald-300 hover:bg-emerald-900/80"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300")
            }
          >
            {editing ? (
              <>
                <Check className="h-3 w-3" />
                完成
              </>
            ) : (
              <>
                <Pencil className="h-3 w-3" />
                编辑
              </>
            )}
          </button>
        </div>
        <SearchBar value={query} onChange={setQuery} />
      </div>

      {editing && (
        <p className="text-xs text-zinc-500">
          点击卡片上的眼睛图标可以隐藏/显示服务
        </p>
      )}

      {grouped.length === 0 && (
        <div className="py-16 text-center text-zinc-500">
          没有找到匹配的服务
        </div>
      )}

      {grouped.map(({ cat, items }) => (
        <section key={cat.id} className="space-y-3">
          {/* Category header */}
          <div className="flex items-center gap-2 pb-1 border-b border-zinc-800">
            <CategoryIcon name={cat.icon} />
            <h2 className="text-sm font-medium text-zinc-300">{cat.label}</h2>
            <span className="text-xs text-zinc-600 ml-1">{items.length}</span>
          </div>

          {/* Cards grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {items.map((service) => (
              <ServiceCard
                key={service.id}
                service={service}
                health={healthMap[service.id]}
                networkMode={networkMode}
                editing={editing}
                hidden={isHidden(service.id)}
                onToggleHidden={() => toggle(service.id)}
              />
            ))}
          </div>

          {/* Surge rule editor in company section */}
          {cat.id === "company" && (<><SurgeRuleEditor /><LogHealthCard /><FeErrorCard /></>)}
        </section>
      ))}
    </div>
  )
}
