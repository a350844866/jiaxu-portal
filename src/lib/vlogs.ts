/**
 * vlogs 客户端(server-only)。LogsQL 构造 / 解析在 vlogs-pure.ts;此处只做 fetch IO。
 * 访问生产 VictoriaLogs:GET ${VLOGS_BASE_URL}/select/logsql/query(家服 IP 白名单,无 secret)。
 * VLOGS_BASE_URL 固定 env,绝不来自请求参数(anti-SSRF)。
 */
import "server-only"
import {
  aggregateHealth,
  buildHealthLogsQL,
  buildQueryLogsQL,
  parseLogLines,
  VlogsError,
  type LogLine,
} from "./vlogs-pure"

async function vlogsFetch(query: string): Promise<string> {
  const base = process.env.VLOGS_BASE_URL
  if (!base) throw new VlogsError("missingEnv", "VLOGS_BASE_URL 未配置")
  const url = `${base}/select/logsql/query?query=${encodeURIComponent(query)}&limit=5000`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20000)
  let res: Response
  try {
    res = await fetch(url, { signal: ctrl.signal, cache: "no-store" })
  } catch (e) {
    throw new VlogsError("timeout", String(e))
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    throw new VlogsError(
      res.status === 403 ? "forbidden" : "badStatus",
      `vlogs ${res.status}`
    )
  }
  return res.text()
}

export async function queryLogs(opts: {
  container: string
  window: string
  keyword?: string
  errorOnly?: boolean
  limit: number
}): Promise<LogLine[]> {
  const text = await vlogsFetch(buildQueryLogsQL(opts))
  return parseLogLines(text, opts.container)
}

export async function healthCounts(
  containers: string[],
  window: string
): Promise<Record<string, number>> {
  const text = await vlogsFetch(buildHealthLogsQL(window))
  return aggregateHealth(text, containers)
}

export { VlogsError } from "./vlogs-pure"
export type { LogLine } from "./vlogs-pure"
