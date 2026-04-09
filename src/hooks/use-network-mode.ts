"use client"

import { useState, useEffect } from "react"

export type NetworkMode = "internal" | "external"

export function useNetworkMode(): NetworkMode {
  const [mode, setMode] = useState<NetworkMode>("external")

  useEffect(() => {
    const hostname = window.location.hostname
    if (
      /^192\.168\.31\.\d+$/.test(hostname) ||
      hostname === "localhost" ||
      hostname === "127.0.0.1"
    ) {
      setMode("internal")
    }
  }, [])

  return mode
}
