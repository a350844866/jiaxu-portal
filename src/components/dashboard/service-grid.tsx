"use client"

import { useMemo } from "react"
import { ServiceDefinition, HealthResult, ServiceCategory } from "@/config/services"
import { categories } from "@/config/categories-data"
import { ServiceCard } from "./service-card"
import { SearchBar } from "./search-bar"
import { useServiceFilter } from "@/hooks/use-service-filter"
import * as LucideIcons from "lucide-react"

interface ServiceGridProps {
  services: ServiceDefinition[]
  initialHealth: HealthResult[]
}

function CategoryIcon({ name }: { name: string }) {
  const Icon = (LucideIcons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[name]
  if (!Icon) return null
  return <Icon className="h-4 w-4 text-zinc-400" />
}

export function ServiceGrid({ services, initialHealth }: ServiceGridProps) {
  const { query, setQuery, filtered } = useServiceFilter(services)

  const healthMap = useMemo(
    () => Object.fromEntries(initialHealth.map((h) => [h.id, h])),
    [initialHealth]
  )

  const grouped = useMemo(() => {
    return categories
      .map((cat) => ({
        cat,
        items: filtered.filter((s) => s.category === cat.id),
      }))
      .filter((g) => g.items.length > 0)
  }, [filtered])

  return (
    <div className="space-y-8">
      {/* Search bar — only show if not filtering already shows all */}
      <div className="flex justify-end">
        <SearchBar value={query} onChange={setQuery} />
      </div>

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
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
