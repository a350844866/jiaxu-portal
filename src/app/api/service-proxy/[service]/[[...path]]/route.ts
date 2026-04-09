export const dynamic = "force-dynamic"

const SERVICE_BACKENDS: Record<string, string> = {
  "surge-traffic": `http://${process.env.DOCKER_HOST_INTERNAL || "host.docker.internal"}:8866`,
  "plex-manage": `http://${process.env.DOCKER_HOST_INTERNAL || "host.docker.internal"}:3210`,
}

const SKIP_REQUEST_HEADERS = new Set([
  "host", "connection", "keep-alive", "transfer-encoding", "accept-encoding",
])
const SKIP_RESPONSE_HEADERS = new Set([
  "transfer-encoding", "connection", "keep-alive", "content-encoding",
])

async function proxyToService(request: Request, service: string, pathSegments?: string[]): Promise<Response> {
  const backend = SERVICE_BACKENDS[service]
  if (!backend) {
    return new Response("Unknown service", { status: 404 })
  }

  const url = new URL(request.url)
  const targetPath = pathSegments ? `/${pathSegments.join("/")}` : "/"
  const targetUrl = `${backend}${targetPath}${url.search}`

  const headers = new Headers()
  for (const [key, value] of request.headers.entries()) {
    if (!SKIP_REQUEST_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value)
    }
  }

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body
    // @ts-expect-error duplex needed for streaming body
    init.duplex = "half"
  }

  const res = await fetch(targetUrl, init)

  const responseHeaders = new Headers()
  for (const [key, value] of res.headers.entries()) {
    if (!SKIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
      responseHeaders.set(key, value)
    }
  }

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: responseHeaders,
  })
}

export async function GET(request: Request, { params }: { params: Promise<{ service: string; path?: string[] }> }) {
  const { service, path } = await params
  return proxyToService(request, service, path)
}
export async function POST(request: Request, { params }: { params: Promise<{ service: string; path?: string[] }> }) {
  const { service, path } = await params
  return proxyToService(request, service, path)
}
export async function PUT(request: Request, { params }: { params: Promise<{ service: string; path?: string[] }> }) {
  const { service, path } = await params
  return proxyToService(request, service, path)
}
export async function DELETE(request: Request, { params }: { params: Promise<{ service: string; path?: string[] }> }) {
  const { service, path } = await params
  return proxyToService(request, service, path)
}
export async function PATCH(request: Request, { params }: { params: Promise<{ service: string; path?: string[] }> }) {
  const { service, path } = await params
  return proxyToService(request, service, path)
}
export async function OPTIONS(request: Request, { params }: { params: Promise<{ service: string; path?: string[] }> }) {
  const { service, path } = await params
  return proxyToService(request, service, path)
}
export async function HEAD(request: Request, { params }: { params: Promise<{ service: string; path?: string[] }> }) {
  const { service, path } = await params
  return proxyToService(request, service, path)
}
