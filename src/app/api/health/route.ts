import { NextResponse } from "next/server"
import { services } from "@/config/services-data"
import { checkAllServices } from "@/lib/health-checker"

export const revalidate = 30

export async function GET() {
  const results = await checkAllServices(services)
  return NextResponse.json(results)
}
