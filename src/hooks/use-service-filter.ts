"use client"

import { useState, useMemo } from "react"
import { ServiceDefinition } from "@/config/services"

export function useServiceFilter(services: ServiceDefinition[]) {
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return services
    return services.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags?.some((t) => t.includes(q))
    )
  }, [services, query])

  return { query, setQuery, filtered }
}
