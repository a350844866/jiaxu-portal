export const dynamic = "force-dynamic"

const NACOS_BACKEND = process.env.NACOS_BACKEND_URL || ""
const PROXY_SECRET = process.env.NACOS_PROXY_SECRET || ""

const SKIP_REQUEST_HEADERS = new Set(["host", "connection", "keep-alive", "transfer-encoding", "accept-encoding"])
const SKIP_RESPONSE_HEADERS = new Set([
  "transfer-encoding", "connection", "keep-alive",
  "content-encoding",          // fetch() auto-decompresses, so strip this to avoid double-decode
  "content-security-policy",   // Nacos CSP blocks scripts when served from a different origin
])

async function proxyToNacos(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const targetUrl = `${NACOS_BACKEND}${url.pathname}${url.search}`

  const headers = new Headers()
  for (const [key, value] of request.headers.entries()) {
    if (!SKIP_REQUEST_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value)
    }
  }
  if (PROXY_SECRET) {
    headers.set("X-Portal-Proxy", PROXY_SECRET)
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

  // Skip TLS verification for self-signed certs
  const prevTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"

  let res: Response
  try {
    res = await fetch(targetUrl, init)
  } finally {
    if (prevTls === undefined) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTls
    }
  }

  const responseHeaders = new Headers()
  for (const [key, value] of res.headers.entries()) {
    if (!SKIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
      responseHeaders.set(key, value)
    }
  }

  // Rewrite redirects to stay on portal domain
  const location = responseHeaders.get("location")
  if (location) {
    const rewritten = location.replace(/https?:\/\/nacos\.company\.liulin\.work/i, "")
    responseHeaders.set("location", rewritten)
  }

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: responseHeaders,
  })
}

export async function GET(request: Request) { return proxyToNacos(request) }
export async function POST(request: Request) { return proxyToNacos(request) }
export async function PUT(request: Request) { return proxyToNacos(request) }
export async function DELETE(request: Request) { return proxyToNacos(request) }
export async function PATCH(request: Request) { return proxyToNacos(request) }
export async function OPTIONS(request: Request) { return proxyToNacos(request) }
export async function HEAD(request: Request) { return proxyToNacos(request) }
