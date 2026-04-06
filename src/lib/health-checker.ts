import { ServiceDefinition, HealthResult } from "@/config/services"

export async function checkServiceHealth(
  service: ServiceDefinition
): Promise<HealthResult> {
  const start = Date.now()
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const res = await fetch(service.healthUrl, {
      method: "GET",
      signal: controller.signal,
      // Skip TLS verification for self-signed certs (Portainer, etc.)
      ...(service.healthSkipTls
        ? { next: { revalidate: 0 } }
        : {}),
    })
    clearTimeout(timeout)

    return {
      id: service.id,
      status: res.ok || res.status < 500 ? "up" : "down",
      responseTimeMs: Date.now() - start,
      checkedAt: new Date().toISOString(),
    }
  } catch {
    return {
      id: service.id,
      status: "down",
      responseTimeMs: null,
      checkedAt: new Date().toISOString(),
    }
  }
}

export async function checkAllServices(
  services: ServiceDefinition[]
): Promise<HealthResult[]> {
  const results = await Promise.allSettled(
    services.map((s) => checkServiceHealth(s))
  )
  return results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : {
          id: services[i].id,
          status: "unknown" as const,
          responseTimeMs: null,
          checkedAt: new Date().toISOString(),
        }
  )
}
