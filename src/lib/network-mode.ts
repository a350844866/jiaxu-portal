/**
 * 内网 / 外网模式判定(纯函数,SSR 与客户端共用同一条规则)。
 *
 * 服务卡片内网模式链 LAN 直连地址(getInternalUrl),外网模式链公网域名。
 * 2026-10-18 前只在客户端 useEffect 里判、SSR 初值写死 external——内网打开首页时
 * 首屏 HTML 的卡片 href 全是公网 URL,hydration 完成前点下去会绕公网(hydration race)。
 * 现在 SSR 按请求 Host 算初值(page.tsx),客户端再按 window.location 双向校正
 * (use-network-mode.ts):万一某条反代链路改写了 Host、SSR 判错,也不会卡在错的一侧。
 */

export type NetworkMode = "internal" | "external"

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"])

const LAN_HOSTNAME = /^192\.168\.31\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/

/**
 * 剥端口 / IPv6 方括号并转小写,兼容 Host 头与 location.hostname 两种形态:
 * "192.168.31.66:3200" → "192.168.31.66","[::1]:3200" / "[::1]" → "::1"。
 * 恰好一个冒号才当 host:port;多个冒号是不带方括号的裸 IPv6,原样保留。
 * 畸形值(方括号后还跟别的如 "[::1].example.com"、缺右括号、端口非数字)原样返回,
 * 匹配不上内网规则 → 落 external,不让伪造的 Host 拼出内网形态。
 */
export function hostnameOf(host: string): string {
  const h = host.trim().toLowerCase()
  if (h.startsWith("[")) {
    const m = /^\[([^\]]+)\](?::\d+)?$/.exec(h)
    return m ? m[1] : h
  }
  const colon = h.indexOf(":")
  if (colon >= 0 && colon === h.lastIndexOf(":")) {
    return /^\d+$/.test(h.slice(colon + 1)) ? h.slice(0, colon) : h
  }
  return h
}

/** 家里 LAN(192.168.31.x)/ 本机回环 → internal;其余(公网域名、Tailscale、空值、畸形值)→ external */
export function modeFromHost(host: string | null | undefined): NetworkMode {
  if (!host) return "external"
  const name = hostnameOf(host)
  if (LAN_HOSTNAME.test(name) || LOOPBACK_HOSTNAMES.has(name)) return "internal"
  return "external"
}

/**
 * SSR 取请求 Host:X-Forwarded-Host 首段优先,退化 Host。Next 缺省时会把 Host 抄进
 * X-Forwarded-Host;NPM 原样透传 Host(proxy.ts 的 PROXIED_HOSTS 路由也靠它)。
 * 客户端能自填 X-Forwarded-Host,但只影响它自己首屏链接的初值、hydration 后即被校正,
 * 不涉鉴权——与 clientIp 那种必须防伪造的取值不是一类。
 */
export function requestHost(xForwardedHost: string | null, host: string | null): string | null {
  const first = xForwardedHost?.split(",")[0]?.trim()
  return first || host?.trim() || null
}
