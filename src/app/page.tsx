import { services } from "@/config/services-data"
import { checkAllServices } from "@/lib/health-checker"
import { Header } from "@/components/layout/header"
import { ServiceGrid } from "@/components/dashboard/service-grid"
import { TokenCard } from "@/components/dashboard/token-card"
import { RateLimitCard } from "@/components/dashboard/rate-limit-card"
import { ResourceRail } from "@/components/dashboard/resource-rail"
import { TodoCard } from "@/components/dashboard/todo-card"
import { AINewsCard } from "@/components/dashboard/ai-news-card"

export const revalidate = 30

export default async function Home() {
  const health = await checkAllServices(services)

  return (
    <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 pb-12">
      <Header />
      <div className="-mx-4 sm:-mx-6">
        <ResourceRail />
      </div>
      <TokenCard />
      <RateLimitCard />
      <AINewsCard />
      <TodoCard />
      <ServiceGrid services={services} initialHealth={health} />
      <footer className="mt-12 text-center text-xs text-zinc-600">
        jiaxu-server-home
      </footer>
    </main>
  )
}
