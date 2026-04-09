"use client"

import { useState, useCallback, useEffect } from "react"

const STORAGE_KEY = "jiaxu-portal-hidden-services"

function loadHidden(): Set<string> {
  if (typeof window === "undefined") return new Set()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw) as string[])
  } catch {
    return new Set()
  }
}

function saveHidden(ids: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]))
}

export function useHiddenServices() {
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState(false)

  // Load from localStorage after mount
  useEffect(() => {
    setHidden(loadHidden())
  }, [])

  const toggle = useCallback((id: string) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      saveHidden(next)
      return next
    })
  }, [])

  const isHidden = useCallback((id: string) => hidden.has(id), [hidden])

  return { hidden, editing, setEditing, toggle, isHidden }
}
