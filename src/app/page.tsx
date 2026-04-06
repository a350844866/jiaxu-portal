import { services } from "@/config/services-data"
import { checkAllServices } from "@/lib/health-checker"
import { Header } from "@/components/layout/header"
import { ServiceGrid } from "@/components/dashboard/service-grid"
import { StatusSummary } from "@/components/dashboard/status-summary"

export const revalidate = 30

export default async function Home() {
  const health = await checkAllServices(services)

  return (
    <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 pb-12">
      <Header />
      <div className="mb-6">
        <StatusSummary results={health} />
      </div>
      <ServiceGrid services={services} initialHealth={health} />
      <footer className="mt-12 text-center text-xs text-zinc-600">
        jiaxu-server-home · 192.168.31.66
      </footer>
    </main>
  )
}
