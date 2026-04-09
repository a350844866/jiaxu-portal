import { NextResponse } from "next/server"
import { generateTotpSecret, getTotpUri, isSetupComplete } from "@/lib/auth"
import QRCode from "qrcode"

export const dynamic = "force-dynamic"

export async function GET() {
  // Only allow during initial setup
  if (await isSetupComplete()) {
    return NextResponse.json({ error: "已完成设置" }, { status: 400 })
  }

  const secret = generateTotpSecret()
  const uri = getTotpUri(secret)
  const qrDataUrl = await QRCode.toDataURL(uri, { width: 256, margin: 2 })

  return NextResponse.json({ secret, qrDataUrl })
}
