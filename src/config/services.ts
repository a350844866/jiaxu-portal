export type ServiceCategory =
  | "my-projects"
  | "media"
  | "iot-vehicle"
  | "cloud-files"
  | "monitoring-admin"
  | "company"

export interface ServiceDefinition {
  id: string
  name: string
  description: string
  category: ServiceCategory
  icon: string // lucide-react icon name
  url: string // external HTTPS URL (browser opens this)
  healthUrl: string // internal IP:port (server-side health check)
  healthSkipTls?: boolean // true for self-signed certs (e.g. Portainer)
  tags?: string[]
  isOwn?: boolean // user's own projects — large card, green accent
  internalOnly?: boolean // no external domain, url === healthUrl
}

export interface CategoryDefinition {
  id: ServiceCategory
  label: string
  description: string
  icon: string
}

export interface HealthResult {
  id: string
  status: "up" | "down" | "unknown"
  responseTimeMs: number | null
  checkedAt: string
}

/** Derive the user-facing internal URL from healthUrl (strip path, keep origin) */
export function getInternalUrl(service: ServiceDefinition): string {
  if (service.internalOnly) return service.url
  // Relative URLs are portal-proxied, use as-is in all network modes
  if (service.url.startsWith("/")) return service.url
  try {
    return new URL(service.healthUrl).origin
  } catch {
    return service.healthUrl
  }
}
