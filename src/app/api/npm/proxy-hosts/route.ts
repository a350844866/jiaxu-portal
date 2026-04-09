import { NextResponse } from "next/server"
import { listProxyHosts } from "@/lib/npm-client"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const hosts = await listProxyHosts()
    const simplified = hosts.map((h) => ({
      id: h.id,
      domains: h.domain_names,
      forwardPort: h.forward_port,
      accessListId: h.access_list_id,
      sslForced: h.ssl_forced,
      enabled: h.enabled,
    }))
    return NextResponse.json(simplified)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 }
    )
  }
}
