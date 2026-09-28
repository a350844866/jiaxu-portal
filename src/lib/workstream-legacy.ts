/**
 * 旧战线 id → 新 id（2026-09-28 重划，映射表由生成侧随快照下发，与 Python load_workstream_names 同语义）：
 * 显式写了新 id 的以新 id 为准；多个旧 id 指向同一新 id 时取文件里先出现的。
 * 不做这一步的话，编辑器按新 id 渲染看不到旧行，用户随便保存一次别的名字，
 * serializeConf 只写白名单 id，旧行里的自定义名就被静默删掉（review 2026-09-28）。
 */
export function migrateLegacy(
  parsed: Record<string, string>,
  legacy: Record<string, string>,
  ids: string[]
): Record<string, string> {
  const out: Record<string, string> = {}
  const isLegacy = (k: string) => Object.hasOwn(legacy, k)
  for (const [k, v] of Object.entries(parsed)) if (!isLegacy(k)) out[k] = v
  for (const [k, v] of Object.entries(parsed)) {
    const to = isLegacy(k) ? legacy[k] : undefined
    if (to && ids.includes(to) && !Object.hasOwn(out, to)) out[to] = v
  }
  return out
}
