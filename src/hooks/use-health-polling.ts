"use client"

import { useState, useEffect, useCallback } from "react"
import { HealthResult } from "@/config/services"

const POLL_INTERVAL = 30_000

export function useHealthPolling(initialHealth: HealthResult[]) {
  const [health, setHealth] = useState(initialHealth)

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/health")
      if (res.ok) {
        const data: HealthResult[] = await res.json()
        setHealth(data)
      }
    } catch {
      // keep last known state
    }
  }, [])

  useEffect(() => {
    const id = setInterval(poll, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [poll])

  return health
}
