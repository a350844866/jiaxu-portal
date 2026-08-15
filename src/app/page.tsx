import { Suspense } from "react"
import { services } from "@/config/services-data"
import { checkAllServices } from "@/lib/health-checker"
import { CardSkeleton } from "@/components/dashboard/card-skeleton"
import { Header } from "@/components/layout/header"
import { ServiceGrid } from "@/components/dashboard/service-grid"
import { TokenCard } from "@/components/dashboard/token-card"
import { RateLimitCard } from "@/components/dashboard/rate-limit-card"
import { ResourceRail } from "@/components/dashboard/resource-rail"
import { MacMiniRail } from "@/components/dashboard/mac-mini-rail"
import { StateHubCard } from "@/components/dashboard/state-hub-card"
import { TodoCard } from "@/components/dashboard/todo-card"
import { PmPaperCard } from "@/components/dashboard/pm-paper-card"
import { PmScalpCard } from "@/components/dashboard/pm-scalp-card"
import { TradeMaxCard } from "@/components/dashboard/trademax-card"
import { AINewsCard } from "@/components/dashboard/ai-news-card"
import { N8nCard } from "@/components/dashboard/n8n-card"
import { ZhihuHotCard } from "@/components/dashboard/zhihu-hot-card"
import { ClaudeSessionCard } from "@/components/dashboard/claude-session-card"

/**
 * 显式声明动态渲染。数据链路里有 14 处 `cache: "no-store"` fetch(健康探针 +
 * 各卡片 reader),Next.js 据此本就把本路由判为动态——此前写的 `revalidate = 30`
 * 从未生效过,只会误导人以为首页有 30s 缓存(2026-08-15 核实)。首屏由 Suspense
 * 流式兜底,不需要 ISR。
 */
export const dynamic = "force-dynamic"

/**
 * 43 个健康探针在这里 await,由外层 Suspense 隔开。
 *
 * 2026-08-15 前它在 Home() 顶层 await——首页是无 Suspense 的阻塞式 Server
 * Component,任一探针慢就压住整个首屏(实测 auto-content 探针吃满 5s 超时时
 * TTFB 到 9.3s)。拆成独立边界后,慢的只推迟它自己那块。
 */
async function ServiceGridSection() {
  const health = await checkAllServices(services)
  return <ServiceGrid services={services} initialHealth={health} />
}

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 pb-12">
      <Header />
      <div className="-mx-4 sm:-mx-6">
        <ResourceRail />
      </div>
      <MacMiniRail />
      <ClaudeSessionCard />
      <Suspense fallback={<CardSkeleton />}>
        <StateHubCard />
      </Suspense>
      <TokenCard />
      <RateLimitCard />
      <Suspense fallback={<CardSkeleton />}>
        <AINewsCard />
      </Suspense>
      <Suspense fallback={<CardSkeleton />}>
        <ZhihuHotCard />
      </Suspense>
      <Suspense fallback={<CardSkeleton />}>
        <N8nCard />
      </Suspense>
      <Suspense fallback={<CardSkeleton lines={4} />}>
        <TodoCard />
      </Suspense>
      <PmPaperCard />
      <PmScalpCard />
      <TradeMaxCard account="trademax" />
      <TradeMaxCard account="dls" />
      <TradeMaxCard account="grand" />
      <Suspense fallback={<CardSkeleton lines={6} />}>
        <ServiceGridSection />
      </Suspense>
      <footer className="mt-12 text-center text-xs text-zinc-600">
        jiaxu-server-home
      </footer>
    </main>
  )
}
