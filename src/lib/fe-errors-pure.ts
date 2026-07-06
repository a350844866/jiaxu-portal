/**
 * 前端错误上报(FE_ERROR)纯函数层:LogsQL 构造 + NDJSON 解析聚合。
 * 数据源 = 公司生产 golden-service-web 落的 `FE_ERROR {json}` 单行
 * (vault [[前端错误上报方案]]);IO 在 vlogs.ts feErrorSummary()。
 */
import { toLocal } from "./vlogs-pure"

/** FE_ERROR payload 里我们消费的字段(服务端已清洗限长,此处仍按不可信输入防御) */
type FeErrorPayload = {
  app?: string
  type?: string
  message?: string
  route?: string
  component?: string
  staffId?: string
  sig?: string
  count?: number
}

export type FeErrorSig = {
  sig: string
  type: string
  app: string
  message: string
  route: string
  component: string
  count: number
  users: number
  lastSeenUtc: string
  lastSeenLocal: string
}

export type FeErrorSummary = {
  window: string
  total: number
  users: number
  sigs: number
  parseFailed: number
  top: FeErrorSig[]
}

export const FE_ERRORS_WINDOW = "24h"
const TOP_N = 8
const MARKER = "FE_ERROR {"

export function buildFeErrorsLogsQL(): string {
  // "FE_ERROR" 是我们发明的独立 token(FE_ERROR_ENDPOINT_FAIL 等变体是不同 token 不命中);
  // 即便未来有杂行混入,解析层按 marker+JSON 过滤,不会污染聚合。
  return `_time:${FE_ERRORS_WINDOW} "FE_ERROR" | limit 5000`
}

type SigAcc = {
  sig: string
  type: string
  app: string
  message: string
  route: string
  component: string
  count: number
  users: Set<string>
  lastSeenUtc: string
}

/** vlogs NDJSON → 按签名聚合。坏行计入 parseFailed 跳过,绝不抛。 */
export function aggregateFeErrors(ndjson: string): FeErrorSummary {
  const bySig = new Map<string, SigAcc>()
  const allUsers = new Set<string>()
  let total = 0
  let parseFailed = 0

  for (const raw of ndjson.split("\n")) {
    const line = raw.trim()
    if (!line) continue
    let msg = ""
    let tUtc = ""
    try {
      const d = JSON.parse(line) as Record<string, unknown>
      msg = String(d._msg ?? "")
      tUtc = String(d._time ?? "")
    } catch {
      parseFailed++
      continue
    }
    const idx = msg.indexOf(MARKER)
    if (idx < 0) continue // 非 FE_ERROR 载荷行(如无关命中),静默忽略
    let ev: FeErrorPayload
    try {
      ev = JSON.parse(msg.slice(idx + MARKER.length - 1)) as FeErrorPayload
    } catch {
      parseFailed++
      continue
    }
    const sig = typeof ev.sig === "string" && ev.sig ? ev.sig : "(no-sig)"
    const n = Math.max(1, Number(ev.count) || 1)
    total += n
    const staffId = typeof ev.staffId === "string" ? ev.staffId : ""
    if (staffId) allUsers.add(staffId)

    const acc = bySig.get(sig)
    if (!acc) {
      bySig.set(sig, {
        sig,
        type: str(ev.type),
        app: str(ev.app),
        message: str(ev.message),
        route: str(ev.route),
        component: str(ev.component),
        count: n,
        users: new Set(staffId ? [staffId] : []),
        lastSeenUtc: tUtc,
      })
    } else {
      acc.count += n
      if (staffId) acc.users.add(staffId)
      if (tUtc > acc.lastSeenUtc) {
        // 用最新一条的样本字段(message/route 可能随复现更新)
        acc.lastSeenUtc = tUtc
        acc.message = str(ev.message) || acc.message
        acc.route = str(ev.route) || acc.route
      }
    }
  }

  const top = [...bySig.values()]
    .sort((a, b) => b.count - a.count || (a.lastSeenUtc < b.lastSeenUtc ? 1 : -1))
    .slice(0, TOP_N)
    .map((a) => ({
      sig: a.sig,
      type: a.type,
      app: a.app,
      message: a.message,
      route: a.route,
      component: a.component,
      count: a.count,
      users: a.users.size,
      lastSeenUtc: a.lastSeenUtc,
      lastSeenLocal: toLocal(a.lastSeenUtc),
    }))

  return {
    window: FE_ERRORS_WINDOW,
    total,
    users: allUsers.size,
    sigs: bySig.size,
    parseFailed,
    top,
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : ""
}
