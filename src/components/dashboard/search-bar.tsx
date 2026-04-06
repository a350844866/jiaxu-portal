"use client"

import { Search, X } from "lucide-react"

interface SearchBarProps {
  value: string
  onChange: (v: string) => void
}

export function SearchBar({ value, onChange }: SearchBarProps) {
  return (
    <div className="relative flex items-center">
      <Search className="absolute left-3 h-4 w-4 text-zinc-500 pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="搜索服务…"
        className="h-9 w-48 rounded-lg border border-zinc-700 bg-zinc-800/60 pl-9 pr-8 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-500 focus:bg-zinc-800 transition-all focus:w-64"
      />
      {value && (
        <button
          onClick={() => onChange("")}
          className="absolute right-2 text-zinc-500 hover:text-zinc-300"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
