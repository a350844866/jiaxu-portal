/**
 * state-hub reader — 个人状态汇聚 collector(/data/state-hub, host :3128)的只读客户端.
 *
 * 数据 = iPhone / 公司 MBP 每 5min push 的域名级请求日志(Surge),
 * /v1/now 给"此刻活跃度", /v1/daily 给"今天行为日报".
 * Token 为只读 token(STATE_HUB_READ_TOKEN),与端侧 ingest token 分权.
 */

const BASE = process.env.STATE_HUB_URL || "http://host.docker.internal:3128"
const TOKEN = process.env.STATE_HUB_READ_TOKEN || ""

export interface DomainStat {
  domain: string
  requests: number
  mb: number
  noise?: boolean
}

export interface DeviceNow {
  reporting: "fresh" | "stale"
  last_report_beijing: string | null
  silent_minutes: number | null
  window_min: number
  requests: number
  network: Record<string, number>
  top: DomainStat[]
  noise_requests: number
}

export interface PersonState {
  available: boolean
  summary?: string
  presence?: string
  location?: string
  motion?: string
  driving?: boolean
  focus_mode?: boolean
  phone_battery?: string | number | null
  phone_charging?: boolean
  stale_minutes?: number | null
  as_of_beijing?: string | null
}

export interface StateNow {
  time_beijing: string
  person?: PersonState
  devices: Record<string, DeviceNow>
}

export interface DeviceDaily {
  requests: number
  active_minutes: number
  first_beijing: string | null
  last_beijing: string | null
  mb: number
  network: Record<string, number>
  hourly_requests: number[]
  top: DomainStat[]
  noise_requests: number
}

export interface StateDaily {
  date: string
  generated_beijing: string
  devices: Record<string, DeviceDaily>
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

async function get<T>(path: string): Promise<Result<T>> {
  if (!TOKEN) return { ok: false, error: "STATE_HUB_READ_TOKEN 未配置" }
  try {
    const r = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    })
    if (!r.ok) return { ok: false, error: `state-hub ${r.status}` }
    return { ok: true, data: (await r.json()) as T }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function fetchStateNow(): Promise<Result<StateNow>> {
  return get<StateNow>("/v1/now")
}

export function fetchStateDaily(): Promise<Result<StateDaily>> {
  return get<StateDaily>("/v1/daily")
}
