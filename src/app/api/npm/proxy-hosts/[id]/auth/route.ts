import { NextRequest, NextResponse } from "next/server"
import { setProxyHostAuth } from "@/lib/npm-client"

export const dynamic = "force-dynamic"

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const proxyId = Number(id)
    if (!proxyId) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 })
    }

    const body = await request.json()
    const enabled = Boolean(body.enabled)

    const result = await setProxyHostAuth(proxyId, enabled)
    return NextResponse.json({
      id: result.id,
      domains: result.domain_names,
      accessListId: result.access_list_id,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 }
    )
  }
}
