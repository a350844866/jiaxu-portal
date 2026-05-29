// Serenity 看板的视觉语义单一来源(client-safe 纯常量,无 node:fs)。
// stance / verdict 的颜色不是随手选的:同方向的态度共用同色系,读者扫一眼就能
// 判断"看多增强 / 看空 / 退出"。card/badge/chip 都是完整 Tailwind 字面量,
// 这样 JIT 能静态扫描保留;hex 给 SVG / inline style 用。

import type { Stance, Verdict } from "@/lib/serenity-pure"

export interface StanceStyle {
  icon: string
  label: string
  /** 持仓卡:边框 + 极淡背景 */
  card: string
  /** hover 态边框增强 */
  hover: string
  /** 小徽章 */
  badge: string
  /** accent 竖条 / 圆点 hex */
  hex: string
}

// 看多增强=暖色(火橙最强、翠绿新生);看空/降温=冷色(蓝减仓、品红反手);
// 退出/未入场=中性(灰静默、紫观望)。
export const STANCE: Record<Stance, StanceStyle> = {
  新开: {
    icon: "🆕", label: "新开仓",
    card: "border-emerald-500/30 bg-emerald-500/[0.05]",
    hover: "hover:border-emerald-400/60 hover:shadow-emerald-950/40",
    badge: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
    hex: "#34d399",
  },
  加码: {
    icon: "🔥", label: "加码",
    card: "border-orange-500/35 bg-orange-500/[0.06]",
    hover: "hover:border-orange-400/60 hover:shadow-orange-950/40",
    badge: "border-orange-500/30 bg-orange-500/15 text-orange-300",
    hex: "#fb923c",
  },
  持有: {
    icon: "➡️", label: "持有",
    card: "border-zinc-700/60 bg-zinc-800/20",
    hover: "hover:border-zinc-500/60 hover:shadow-zinc-950/40",
    badge: "border-zinc-600/40 bg-zinc-700/30 text-zinc-300",
    hex: "#a1a1aa",
  },
  减仓: {
    icon: "📉", label: "减仓",
    card: "border-sky-500/30 bg-sky-500/[0.05]",
    hover: "hover:border-sky-400/60 hover:shadow-sky-950/40",
    badge: "border-sky-500/30 bg-sky-500/15 text-sky-300",
    hex: "#38bdf8",
  },
  反手做空: {
    icon: "🔄", label: "反手做空",
    card: "border-fuchsia-500/35 bg-fuchsia-500/[0.06]",
    hover: "hover:border-fuchsia-400/60 hover:shadow-fuchsia-950/40",
    badge: "border-fuchsia-500/30 bg-fuchsia-500/15 text-fuchsia-300",
    hex: "#e879f9",
  },
  转静默: {
    icon: "🤫", label: "转静默",
    card: "border-zinc-800/60 bg-zinc-900/30",
    hover: "hover:border-zinc-700/60",
    badge: "border-zinc-700/40 bg-zinc-800/40 text-zinc-500",
    hex: "#71717a",
  },
  观察: {
    icon: "👀", label: "观察",
    card: "border-violet-500/25 bg-violet-500/[0.04]",
    hover: "hover:border-violet-400/50 hover:shadow-violet-950/40",
    badge: "border-violet-500/30 bg-violet-500/15 text-violet-300",
    hex: "#a78bfa",
  },
}

/** tier 内排序权重:信号越强排越前。 */
export const STANCE_WEIGHT: Record<Stance, number> = {
  加码: 6, 新开: 5, 反手做空: 4, 持有: 3, 减仓: 2, 观察: 1, 转静默: 0,
}

export interface VerdictStyle {
  icon: string
  label: string
  hex: string
  chip: string
}

// verdict 有天然对错语义:绿对、红错、琥珀待定、灰无法判断、紫部分对。
export const VERDICT: Record<Verdict, VerdictStyle> = {
  兑现: { icon: "✅", label: "兑现", hex: "#34d399", chip: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" },
  落空: { icon: "❌", label: "落空", hex: "#f87171", chip: "border-red-500/30 bg-red-500/15 text-red-300" },
  待核: { icon: "⏳", label: "待核", hex: "#fbbf24", chip: "border-amber-500/30 bg-amber-500/15 text-amber-300" },
  不可证伪: { icon: "🚫", label: "不可证伪", hex: "#71717a", chip: "border-zinc-600/40 bg-zinc-700/30 text-zinc-400" },
  归因不稳: { icon: "⚠️", label: "归因不稳", hex: "#a78bfa", chip: "border-violet-500/30 bg-violet-500/15 text-violet-300" },
}

// ── 产业链分层 ──
// Serenity 的链条母图:上游材料/衬底/激光 → 中游器件/光引擎/存储 → 终端算力/系统。
export type TierKey = "upstream" | "midstream" | "downstream" | "infra"

export const TIER: Record<TierKey, { label: string; sub: string; hex: string }> = {
  upstream: { label: "上游 · 材料 / 衬底 / 激光", sub: "chokepoint 卡位", hex: "#34d399" },
  midstream: { label: "中游 · 器件 / 光引擎 / 存储", sub: "放量受益", hex: "#38bdf8" },
  downstream: { label: "终端 · 算力 / 系统", sub: "需求拉动", hex: "#a78bfa" },
  infra: { label: "基础设施 / 其它", sub: "外延配置", hex: "#a1a1aa" },
}

export const TIER_ORDER: TierKey[] = ["upstream", "midstream", "downstream", "infra"]

// 从自由文本 chain 字段启发式归类。判定顺序刻意为 终端 → 中游 → 上游 → 基础设施:
// 这样 "光子/激光 fab"(含"激光"也含"fab")正确落到中游,"memory 代理" 落到中游而非
// 按"代理"误归 infra。已对当前 14 个持仓的 chain 值逐一核验通过。chain 原文仍在卡片
// 上权威展示,即使个别归层不准也只影响视觉分组、不影响数据。
export function inferTier(chain: string): TierKey {
  const s = chain.toLowerCase()
  if (/算力|neocloud|tpu|agentic|hardware|系统|终端/.test(s)) return "downstream"
  if (/fab|光引擎|transceiver|power|dram|hbm|memory|存储|传感|器件/.test(s)) return "midstream"
  if (/衬底|substrate|epitaxy|外延|激光|sic|soi|inp|core|foundry|上游/.test(s)) return "upstream"
  if (/电网|变压器|代理|etf/.test(s)) return "infra"
  return "infra"
}

/** 统一面板外观(章节内的卡片容器复用)。 */
export const PANEL = "rounded-2xl border border-zinc-800/80 bg-zinc-900/30 backdrop-blur-sm"
