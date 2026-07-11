import Link from "next/link"
import { cn } from "@/lib/utils"

/** pm-scalp 模拟盘 / 实盘 双页 tab 导航（两页共用） */
export function PmScalpTabs({ active }: { active: "paper" | "real" }) {
  const tab = (href: string, label: string, isActive: boolean) => (
    <Link
      href={href}
      className={cn(
        "rounded-lg border px-3 py-1.5 text-xs transition-colors",
        isActive
          ? "border-zinc-600 bg-zinc-800/80 font-medium text-zinc-100"
          : "border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300",
      )}
    >
      {label}
    </Link>
  )
  return (
    <nav className="flex gap-2">
      {tab("/pm-scalp", "模拟盘 forward test", active === "paper")}
      {tab("/pm-scalp/real", "实盘 LIVE", active === "real")}
    </nav>
  )
}
