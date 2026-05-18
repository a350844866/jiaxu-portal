/**
 * Server-side proxy to wife-mt4-observer FastAPI.
 *
 * Why a dedicated route (not service-proxy):
 *   POST /api/wife-mt4/hypotheses + /verify endpoints require X-Auth-Token,
 *   and we don't want that token round-tripping through the browser. Inject
 *   it server-side from WIFE_OBSERVER_API_TOKEN env.
 *
 * GETs are open on the upstream — pass through unchanged.
 *
 * Path mapping:
 *   /api/wife-mt4/positions          → http://wife-mt4-api:3123/api/positions
 *   /api/wife-mt4/hypotheses?status= → http://wife-mt4-api:3123/api/wife-mt4/hypotheses?status=
 *   /api/wife-mt4/hypotheses/12/verify → http://wife-mt4-api:3123/api/wife-mt4/hypotheses/12/verify
 *
 * Path translation rule: take everything after /api/wife-mt4/ and prepend /api/.
 * The upstream uses /api/wife-mt4/hypotheses for hypothesis CRUD and /api/{positions,history,...}
 * for read endpoints. We unify under /api/wife-mt4/* on the portal side and
 * re-route to the right upstream path.
 */
export const dynamic = "force-dynamic"

const BACKEND = process.env.WIFE_OBSERVER_BACKEND_URL || "http://wife-mt4-api:3123"
const API_TOKEN = process.env.WIFE_OBSERVER_API_TOKEN || ""

const SKIP_REQUEST_HEADERS = new Set([
  "host", "connection", "keep-alive", "transfer-encoding", "accept-encoding",
])
const SKIP_RESPONSE_HEADERS = new Set([
  "transfer-encoding", "connection", "keep-alive", "content-encoding",
])

const READ_ALIASES: Record<string, string> = {
  positions: "/api/positions",
  account: "/api/account",
  history: "/api/history",
  "equity-curve": "/api/equity-curve",
  healthz: "/healthz",
}

function resolveUpstreamPath(segments: string[]): string {
  if (segments.length === 0) return "/healthz"
  const head = segments[0]
  if (head in READ_ALIASES && segments.length === 1) {
    return READ_ALIASES[head]
  }
  return `/api/wife-mt4/${segments.join("/")}`
}

async function proxy(request: Request, segments: string[]): Promise<Response> {
  const url = new URL(request.url)
  const upstreamPath = resolveUpstreamPath(segments)
  const targetUrl = `${BACKEND}${upstreamPath}${url.search}`

  const headers = new Headers()
  for (const [key, value] of request.headers.entries()) {
    if (!SKIP_REQUEST_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value)
    }
  }

  const isWrite = request.method !== "GET" && request.method !== "HEAD"
  if (isWrite && API_TOKEN) {
    headers.set("X-Auth-Token", API_TOKEN)
  }

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  }

  if (isWrite) {
    init.body = await request.arrayBuffer()
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

type RouteContext = { params: Promise<{ path?: string[] }> }

export async function GET(request: Request, ctx: RouteContext): Promise<Response> {
  const { path } = await ctx.params
  return proxy(request, path ?? [])
}

export async function POST(request: Request, ctx: RouteContext): Promise<Response> {
  const { path } = await ctx.params
  return proxy(request, path ?? [])
}
