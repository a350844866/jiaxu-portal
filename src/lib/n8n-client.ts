// n8n REST API client (https://docs.n8n.io/api/)
// Requires N8N_API_URL + N8N_API_KEY env. User generates API key from n8n UI
// after first-time owner setup (Settings → n8n API → Create API Key).

const N8N_API_URL = process.env.N8N_API_URL || ""
const N8N_API_KEY = process.env.N8N_API_KEY || ""
const N8N_PUBLIC_URL = process.env.N8N_PUBLIC_URL || "https://n8n.liulin.work"

export interface N8nWorkflow {
  id: string
  name: string
  active: boolean
}

export interface N8nExecution {
  id: string
  finished: boolean
  mode: string
  startedAt: string
  stoppedAt: string | null
  workflowId: string
  status: "success" | "error" | "running" | "waiting" | "canceled" | "crashed" | "new"
}

export interface N8nSnapshot {
  ok: boolean
  configured: boolean
  reachable: boolean
  workflowsTotal: number
  workflowsActive: number
  execsLast24h: number
  execsSuccess24h: number
  execsFailed24h: number
  lastExec: N8nExecution | null
  publicUrl: string
  error?: string
}

async function n8nFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${N8N_API_URL}${path}`, {
    ...init,
    headers: {
      "X-N8N-API-KEY": N8N_API_KEY,
      Accept: "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  })
}

export async function readSnapshot(): Promise<N8nSnapshot> {
  const base: N8nSnapshot = {
    ok: false,
    configured: Boolean(N8N_API_URL && N8N_API_KEY),
    reachable: false,
    workflowsTotal: 0,
    workflowsActive: 0,
    execsLast24h: 0,
    execsSuccess24h: 0,
    execsFailed24h: 0,
    lastExec: null,
    publicUrl: N8N_PUBLIC_URL,
  }

  if (!base.configured) {
    return { ...base, error: "N8N_API_KEY 未配置" }
  }

  try {
    const wfRes = await n8nFetch("/api/v1/workflows?limit=250")
    if (!wfRes.ok) {
      return { ...base, error: `workflows ${wfRes.status}` }
    }
    const wfBody = (await wfRes.json()) as { data?: N8nWorkflow[] }
    const wfs = wfBody.data || []
    base.workflowsTotal = wfs.length
    base.workflowsActive = wfs.filter((w) => w.active).length
    base.reachable = true

    const execRes = await n8nFetch("/api/v1/executions?limit=250&includeData=false")
    if (execRes.ok) {
      const execBody = (await execRes.json()) as { data?: N8nExecution[] }
      const execs = execBody.data || []
      const since = Date.now() - 24 * 3600 * 1000
      const recent = execs.filter((e) => new Date(e.startedAt).getTime() >= since)
      base.execsLast24h = recent.length
      base.execsSuccess24h = recent.filter((e) => e.status === "success").length
      base.execsFailed24h = recent.filter((e) =>
        ["error", "crashed", "canceled"].includes(e.status)
      ).length
      base.lastExec = execs[0] || null
    }

    base.ok = true
    return base
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) }
  }
}
