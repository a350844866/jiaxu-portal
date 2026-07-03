// AI 全产业链看板的视觉语义单一来源(client-safe 纯常量)。
// CP(chokepoint)三档:是=琥珀(稀缺如金)、部分=天蓝(有议价权可绕)、否=中性灰(可替代/纯 beta)。
// 信号四型:bullish 翠绿▲ / bearish 红▼ / watch 琥珀◉ / avoid 玫红⛔。
// 完整 Tailwind 字面量,JIT 静态扫描可保留。

import type { CpLevel, SignalType, SignalSource } from "@/lib/ai-chain-pure"

export interface CpStyle {
  label: string
  badge: string
  card: string
  hex: string
}

export const CP: Record<CpLevel, CpStyle> = {
  yes: {
    label: "chokepoint",
    badge: "border-amber-500/35 bg-amber-500/15 text-amber-300",
    card: "border-amber-500/25 bg-amber-500/[0.04]",
    hex: "#fbbf24",
  },
  partial: {
    label: "部分",
    badge: "border-sky-500/30 bg-sky-500/12 text-sky-300",
    card: "border-zinc-800/80 bg-zinc-900/40",
    hex: "#38bdf8",
  },
  no: {
    label: "非卡点",
    badge: "border-zinc-700/40 bg-zinc-800/40 text-zinc-500",
    card: "border-zinc-800/60 bg-zinc-900/25",
    hex: "#71717a",
  },
}

export interface SignalStyle {
  icon: string
  label: string
  chip: string
}

export const SIGNAL: Record<SignalType, SignalStyle> = {
  bullish: { icon: "▲", label: "看多", chip: "border-emerald-500/30 bg-emerald-500/12 text-emerald-300" },
  bearish: { icon: "▼", label: "看空", chip: "border-red-500/30 bg-red-500/12 text-red-300" },
  watch: { icon: "◉", label: "观察", chip: "border-amber-500/30 bg-amber-500/12 text-amber-300" },
  avoid: { icon: "⛔", label: "回避", chip: "border-rose-500/35 bg-rose-500/12 text-rose-300" },
}

/** 信号来源短标(卡片空间小,一两个字)。 */
export const SOURCE_LABEL: Record<SignalSource, string> = {
  alan: "Alan",
  serenity: "白毛",
  taieo: "Taieo",
  claude: "C",
}

/** 涨跌配色(与 serenity 看板 verdict 绿对红错同语义:美股绿涨红跌)。 */
export function pctColor(v: number | null): string {
  if (v == null) return "text-zinc-600"
  if (v > 0) return "text-emerald-400"
  if (v < 0) return "text-red-400"
  return "text-zinc-400"
}

/** 统一面板外观(与 serenity 看板 PANEL 一致)。 */
export const PANEL = "rounded-2xl border border-zinc-800/80 bg-zinc-900/30 backdrop-blur-sm"
