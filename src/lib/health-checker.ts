import { ServiceDefinition, HealthResult } from "@/config/services"

/**
 * 单个探针超时。内网服务正常都在 600ms 内(实测最慢 plex-manage 558ms),
 * 2.5s 已是很宽的余量。原值 5s——normal / skipTls 是两个串行窗口,最坏叠成
 * 10s,真挂一个服务首页就多等这么久(2026-08-15 收紧)。
 */
const CHECK_TIMEOUT_MS = 2500

function checkOne(service: ServiceDefinition): Promise<HealthResult> {
  const start = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)

  return fetch(service.healthUrl, {
    method: "GET",
    signal: controller.signal,
    cache: "no-store",
    redirect: "manual",
  })
    .then((res) => ({
      id: service.id,
      status: (res.ok || res.status < 500 ? "up" : "down") as HealthResult["status"],
      responseTimeMs: Date.now() - start,
      checkedAt: new Date().toISOString(),
    }))
    .catch(() => ({
      id: service.id,
      status: "down" as const,
      responseTimeMs: null,
      checkedAt: new Date().toISOString(),
    }))
    .finally(() => clearTimeout(timeout))
}

export async function checkAllServices(
  services: ServiceDefinition[]
): Promise<HealthResult[]> {
  const normal = services.filter(
    (s) => !s.healthSkipTls || !s.healthUrl.startsWith("https")
  )
  const skipTls = services.filter(
    (s) => s.healthSkipTls && s.healthUrl.startsWith("https")
  )

  // Run normal checks concurrently
  const normalResults = await Promise.all(normal.map(checkOne))

  // Run TLS-skip checks in an isolated env window (no overlap with normal)
  let skipResults: HealthResult[] = []
  if (skipTls.length > 0) {
    const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
    try {
      skipResults = await Promise.all(skipTls.map(checkOne))
    } finally {
      if (prev === undefined) {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
      } else {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev
      }
    }
  }

  // Merge back in original order
  const map = new Map<string, HealthResult>()
  for (const r of [...normalResults, ...skipResults]) map.set(r.id, r)
  return services.map((s) => map.get(s.id)!)
}
