// pm-paper 看板视觉语义单一来源(client-safe 纯常量,与 serenity/ai-chain 看板同语言)。
// rule_flag 三档:rule_trap=红(结算条款有陷阱,散户/模型都容易误判)、
// rule_edge=黄(条款有技术性细节需注意)、ok=灰(清晰无坑)。
// confidence 三档沿用 serenity 的"暖=有把握"直觉:high 翠绿、medium 天蓝、low 灰。

export const PANEL = "rounded-2xl border border-zinc-800/80 bg-zinc-900/30 backdrop-blur-sm"

export interface RuleFlagStyle {
  label: string
  badge: string
}

export const RULE_FLAG: Record<string, RuleFlagStyle> = {
  rule_trap: { label: "规则陷阱", badge: "border-red-500/35 bg-red-500/15 text-red-300" },
  rule_edge: { label: "规则边缘", badge: "border-amber-500/35 bg-amber-500/15 text-amber-300" },
  ok: { label: "规则清晰", badge: "border-zinc-600/40 bg-zinc-700/30 text-zinc-400" },
  unreviewed: { label: "未审核", badge: "border-zinc-700/40 bg-zinc-800/40 text-zinc-500" },
}

export function ruleFlagStyle(flag: string | null): RuleFlagStyle {
  return RULE_FLAG[flag ?? ""] ?? RULE_FLAG.unreviewed
}

export interface ConfidenceStyle {
  label: string
  chip: string
}

export const CONFIDENCE: Record<string, ConfidenceStyle> = {
  high: { label: "高", chip: "border-emerald-500/30 bg-emerald-500/12 text-emerald-300" },
  medium: { label: "中", chip: "border-sky-500/30 bg-sky-500/12 text-sky-300" },
  low: { label: "低", chip: "border-zinc-600/40 bg-zinc-700/30 text-zinc-400" },
}

export function confidenceStyle(c: string): ConfidenceStyle {
  return CONFIDENCE[c] ?? CONFIDENCE.low
}

export const COHORT_LABEL: Record<string, string> = {
  politics: "政治",
  data: "数据",
}

export function cohortChip(cohort: string | null): string {
  if (cohort === "politics") return "border-violet-500/30 bg-violet-500/12 text-violet-300"
  if (cohort === "data") return "border-sky-500/30 bg-sky-500/12 text-sky-300"
  return "border-zinc-700/40 bg-zinc-800/40 text-zinc-500"
}

export function sideColor(side: string): string {
  if (side === "YES") return "text-emerald-400"
  if (side === "NO") return "text-rose-400"
  return "text-zinc-400"
}

export function pnlColor(n: number | null | undefined): string {
  if (n == null) return "text-zinc-500"
  if (n > 0) return "text-emerald-400"
  if (n < 0) return "text-rose-400"
  return "text-zinc-400"
}

/** Brier: 越低越准。返回 claude 是否赢(null = 无法比较,通常样本不足)。 */
export function brierWinner(claude: number | null, market: number | null): boolean | null {
  if (claude == null || market == null) return null
  return claude < market
}
