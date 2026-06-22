import { services } from "@/config/services-data"
import { checkAllServices } from "@/lib/health-checker"
import { Header } from "@/components/layout/header"
import { ServiceGrid } from "@/components/dashboard/service-grid"
import { TokenCard } from "@/components/dashboard/token-card"
import { RateLimitCard } from "@/components/dashboard/rate-limit-card"
import { ResourceRail } from "@/components/dashboard/resource-rail"
import { MacMiniRail } from "@/components/dashboard/mac-mini-rail"
import { TodoCard } from "@/components/dashboard/todo-card"
import { AINewsCard } from "@/components/dashboard/ai-news-card"
import { N8nCard } from "@/components/dashboard/n8n-card"
import { ZhihuHotCard } from "@/components/dashboard/zhihu-hot-card"

export const revalidate = 30

export default async function Home() {
  const health = await checkAllServices(services)

  return (
    <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 pb-12">
      <Header />
      <div className="-mx-4 sm:-mx-6">
        <ResourceRail />
      </div>
      <MacMiniRail />
      <TokenCard />
      <RateLimitCard />
      <AINewsCard />
      <ZhihuHotCard />
      <N8nCard />
      <TodoCard />
      <ServiceGrid services={services} initialHealth={health} />
      <footer className="mt-12 text-center text-xs text-zinc-600">
        jiaxu-server-home
      </footer>
    </main>
  )
}
