const NPM_URL = process.env.NPM_URL || ""
const NPM_EMAIL = process.env.NPM_EMAIL || ""
const NPM_PASSWORD = process.env.NPM_PASSWORD || ""
const NPM_ACCESS_LIST_ID = Number(process.env.NPM_ACCESS_LIST_ID || "1")

let cachedToken: { token: string; expiresAt: number } | null = null

async function npmFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getToken()
  return fetch(`${NPM_URL}/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  })
}

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token
  }
  const res = await fetch(`${NPM_URL}/api/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: NPM_EMAIL, secret: NPM_PASSWORD }),
  })
  if (!res.ok) throw new Error(`NPM auth failed: ${res.status}`)
  const data = await res.json()
  cachedToken = {
    token: data.token,
    expiresAt: new Date(data.expires).getTime(),
  }
  return data.token
}

export interface NpmProxyHost {
  id: number
  domain_names: string[]
  forward_host: string
  forward_port: number
  forward_scheme: string
  access_list_id: number
  ssl_forced: boolean
  certificate_id: number
  enabled: boolean
  meta: Record<string, unknown>
}

export async function listProxyHosts(): Promise<NpmProxyHost[]> {
  const res = await npmFetch("/nginx/proxy-hosts")
  if (!res.ok) throw new Error(`NPM list failed: ${res.status}`)
  return res.json()
}

export async function getProxyHost(id: number): Promise<NpmProxyHost> {
  const res = await npmFetch(`/nginx/proxy-hosts/${id}`)
  if (!res.ok) throw new Error(`NPM get ${id} failed: ${res.status}`)
  return res.json()
}

export async function setProxyHostAuth(
  id: number,
  enabled: boolean
): Promise<NpmProxyHost> {
  // Fetch current state to preserve all fields
  const current = await getProxyHost(id)
  const accessListId = enabled ? NPM_ACCESS_LIST_ID : 0

  const res = await npmFetch(`/nginx/proxy-hosts/${id}`, {
    method: "PUT",
    body: JSON.stringify({
      domain_names: current.domain_names,
      forward_scheme: current.forward_scheme,
      forward_host: current.forward_host,
      forward_port: current.forward_port,
      certificate_id: current.certificate_id,
      ssl_forced: current.ssl_forced,
      http2_support: true,
      block_exploits: true,
      allow_websocket_upgrade: true,
      access_list_id: accessListId,
      meta: current.meta || {},
      advanced_config: "",
      locations: [],
      caching_enabled: false,
      hsts_enabled: false,
      hsts_subdomains: false,
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`NPM update ${id} failed: ${res.status} ${text}`)
  }
  return res.json()
}
