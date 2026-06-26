/**
 * vlogs 纯函数(client-safe,无 IO / 无 secret):LogsQL 构造、关键词转义、NDJSON 解析。
 * IO(fetch)在 vlogs.ts(server-only)。拆分便于单测 + 不把查询逻辑漏进 client bundle。
 */
export type LogLine = {
  tUtc: string
  tLocal: string
  level: string
  container: string
  msg: string
}

export type VlogsErrorKind =
  | "missingEnv"
  | "timeout"
  | "badStatus"
  | "forbidden"
  | "parse"
export class VlogsError extends Error {
  kind: VlogsErrorKind
  constructor(kind: VlogsErrorKind, message?: string) {
    super(message ?? kind)
    this.kind = kind
    this.name = "VlogsError"
  }
}

const ERROR_PRESET =
  '("ERROR" OR "Exception" OR "Caused by" OR "Got unchecked and undeclared exception" OR "exceptionHandler" OR "FATAL")'
// 健康信号:ERROR 级日志(含被 catch 后记成 ERROR 的 SQLException 等真 bug)+ HTTP 未处理异常。
// 圈到 28 个 Nacos 服务后 ERROR 基线极低(实测全 28 服务近 1h 仅个位数),故可用 ERROR 而不刷屏。
const HEALTH_SIGNAL = '("ERROR" OR "exceptionHandler")'

// 已知后台噪声短语,从健康红绿信号里精确剔除(均为纯后台线程、零请求级影响,见 [[incident-2026-06-24-8921连接池请求级升级]] §19):
//  - "create connection SQLException": Druid 后台 CreateConnectionThread 建连撞 8921 丢 SYN(Spring Boot logback 格式,线程 [reate-*])
//  - "CreateConnectionThread"        : 同上,另一种日志格式(eladmin 等 `method:...DruidDataSource$CreateConnectionThread.run`)
//  - "ReconnectTimerTask"            : Dubbo 后台重连定时器(HashedWheelTimer)对死 provider 的 ghost 重连(data-inspection-web 等)
//      ↳ 为何用 ReconnectTimerTask 而非更窄的 "DubboMetadataService":被计数的 ERROR 行就是
//        `method:...ReconnectTimerTask.doTask(...)`,DubboMetadataService 只落在分离的 stack 行(实测 -"DubboMetadataService" 不降噪);
//        且它永远是后台重连遥测——provider 真挂了业务调用会在【请求线程】报 RpcException/exceptionHandler(不在剔除列表→照常红),不会被这条埋掉。
// 刻意不剔(=真信号/金丝雀,且本就不含上述短语→自然透传):
//   slow sql(真慢查询) / execute error+CommunicationsException(请求·Dubbo 线程,在途断连金丝雀) /
//   GetConnectionTimeoutException+CannotGetJdbcConnection(8921 真升级请求级,必须报红) / exceptionHandler(HTTP 未处理异常)。
// ⚠ 这是 signal AND NOT noise:加剔除短语前务必确认它不会内嵌在某真信号行里(否则会误埋)。
const HEALTH_NOISE_PHRASES = [
  "create connection SQLException",
  "CreateConnectionThread",
  "ReconnectTimerTask",
]

// 拒绝管道符与控制字符;空格/连字符/中文等照常允许(都在引号短语内,安全)
const KEYWORD_DENY = new RegExp("[|\\u0000-\\u001f]")

/** 关键词安全:转义 \\ 和 ",包成短语;含 | 或控制字符 → 抛 BAD_KEYWORD(防拼接成 | stats 等改写查询)。 */
export function quoteLogsQLString(s: string): string {
  if (KEYWORD_DENY.test(s)) {
    throw new Error("BAD_KEYWORD")
  }
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'
}

export function buildQueryLogsQL(opts: {
  container: string
  window: string
  keyword?: string
  errorOnly?: boolean
  limit: number
}): string {
  let q = `_time:${opts.window} {path=~".*${opts.container}.*"}`
  if (opts.errorOnly) q += ` ${ERROR_PRESET}`
  if (opts.keyword) q += ` ${quoteLogsQLString(opts.keyword)}`
  q += ` | limit ${opts.limit}`
  return q
}

export function buildHealthLogsQL(window: string): string {
  // 用 quoteLogsQLString 渲染(自动转义 \ 与 "、拒非法字符),与 keyword 路径一致、未来加短语更安全
  const exclude = HEALTH_NOISE_PHRASES.map((p) => `-${quoteLogsQLString(p)}`).join(" ")
  return `_time:${window} ${HEALTH_SIGNAL} ${exclude} | stats by (_stream) count() c`
}

/** 从 _stream 路径 `.../containers/<pod>_<ns>_<container>-<id>.log` 提取容器名。 */
export function containerFromStream(stream: string): string | null {
  const m = /containers\/(.+?)\.log/.exec(stream)
  if (!m) return null
  const parts = m[1].split("_")
  if (parts.length < 3) return null
  return parts[parts.length - 1].replace(/-[0-9a-f]{12,}$/, "")
}

function parseLevel(msg: string): string {
  const m =
    /\[(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\]|\b(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\b/.exec(
      msg
    )
  return m?.[1] ?? m?.[2] ?? "—"
}

/** UTC ISO → 北京时间 "YYYY-MM-DD HH:mm:ss"(vlogs _time 是 UTC)。 */
export function toLocal(tUtc: string): string {
  const d = new Date(tUtc)
  if (isNaN(d.getTime())) return tUtc
  return new Date(d.getTime() + 8 * 3600 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19)
}

/** 解析 vlogs NDJSON 为 LogLine[](时间倒序,最新在上)。坏 JSON → VlogsError("parse")。 */
export function parseLogLines(ndjson: string, container: string): LogLine[] {
  const lines: LogLine[] = []
  for (const raw of ndjson.split("\n")) {
    const t = raw.trim()
    if (!t) continue
    let d: Record<string, unknown>
    try {
      d = JSON.parse(t)
    } catch {
      throw new VlogsError("parse", "NDJSON 解析失败")
    }
    const msg = String(d._msg ?? "")
    const tUtc = String(d._time ?? "")
    lines.push({ tUtc, tLocal: toLocal(tUtc), level: parseLevel(msg), container, msg })
  }
  lines.sort((a, b) => (a.tUtc < b.tUtc ? 1 : a.tUtc > b.tUtc ? -1 : 0))
  return lines
}

/** 聚合健康计数:按容器累加(同容器多 pod/重启会有多条 _stream),只留 want 内的。 */
export function aggregateHealth(
  ndjson: string,
  containers: string[]
): Record<string, number> {
  const want = new Set(containers)
  const counts: Record<string, number> = {}
  for (const raw of ndjson.split("\n")) {
    const t = raw.trim()
    if (!t) continue
    let d: Record<string, unknown>
    try {
      d = JSON.parse(t)
    } catch {
      throw new VlogsError("parse", "NDJSON 解析失败")
    }
    const c = containerFromStream(String(d._stream ?? ""))
    if (c && want.has(c)) counts[c] = (counts[c] ?? 0) + Number(d.c ?? 0)
  }
  return counts
}
