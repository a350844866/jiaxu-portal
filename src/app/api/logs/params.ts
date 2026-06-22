import { containerOf, isKnownService } from "@/config/log-services"
import { quoteLogsQLString } from "@/lib/vlogs-pure"

const WINDOWS = new Set(["15m", "30m", "1h", "3h", "6h", "1d"])

export type LogsParams = {
  service: string
  container: string
  window: string
  keyword?: string
  errorOnly: boolean
  limit: number
}

/** 解析/校验 /api/logs 入参;非法抛 BAD_SERVICE / BAD_WINDOW / BAD_KEYWORD。 */
export function parseLogsParams(sp: URLSearchParams): LogsParams {
  const service = sp.get("service") ?? ""
  if (!isKnownService(service)) throw new Error("BAD_SERVICE")

  const window = sp.get("window") ?? "30m"
  if (!WINDOWS.has(window)) throw new Error("BAD_WINDOW")

  const rawLimit = parseInt(sp.get("limit") ?? "", 10)
  const limit = Number.isFinite(rawLimit) ? Math.min(1000, Math.max(1, rawLimit)) : 200

  const errorOnly = sp.get("errorOnly") === "1" || sp.get("errorOnly") === "true"

  const keywordRaw = sp.get("keyword")?.trim()
  let keyword: string | undefined
  if (keywordRaw) {
    quoteLogsQLString(keywordRaw) // 预检:含 | / 控制字符 → 抛 BAD_KEYWORD
    keyword = keywordRaw
  }

  return { service, container: containerOf(service)!, window, keyword, errorOnly, limit }
}

/** 解析 /api/logs/health 的 window;默认 1h,非法抛 BAD_WINDOW。 */
export function parseHealthWindow(sp: URLSearchParams): string {
  const window = sp.get("window") ?? "1h"
  if (!WINDOWS.has(window)) throw new Error("BAD_WINDOW")
  return window
}
