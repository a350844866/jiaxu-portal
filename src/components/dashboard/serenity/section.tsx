import type { ReactNode } from "react"

// 一"幕"= 带序号圆章 + 图标 + 标题 + 副标题 + 向右渐隐的 accent 线。
// 序号和 accent 线把四幕串成一条阅读动线,这是页面"有逻辑"的视觉表达。
export function Act({
  index,
  title,
  subtitle,
  icon,
  accent = "#a1a1aa",
  delay = 0,
  children,
}: {
  index: string
  title: string
  subtitle?: string
  icon?: ReactNode
  accent?: string
  delay?: number
  children: ReactNode
}) {
  return (
    <section
      className="relative animate-in fade-in-0 slide-in-from-bottom-3 fill-mode-both duration-700"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="mb-4 flex items-center gap-3">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums"
          style={{ borderColor: `${accent}55`, color: accent, background: `${accent}12` }}
        >
          {index}
        </span>
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold tracking-wide text-zinc-100">
            {icon}
            {title}
          </h2>
          {subtitle && <p className="mt-0.5 text-[11px] leading-tight text-zinc-500">{subtitle}</p>}
        </div>
        <div
          className="ml-1 h-px flex-1"
          style={{ background: `linear-gradient(to right, ${accent}40, transparent)` }}
        />
      </div>
      {children}
    </section>
  )
}

/** 小统计块:大数字 + 标签,可选 accent 色。 */
export function Stat({
  value,
  label,
  accent,
  hint,
}: {
  value: ReactNode
  label: string
  accent?: string
  hint?: string
}) {
  return (
    <div className="rounded-xl border border-zinc-800/70 bg-zinc-900/40 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div
        className="mt-0.5 text-2xl font-semibold tabular-nums leading-none"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-[10px] text-zinc-600">{hint}</div>}
    </div>
  )
}
