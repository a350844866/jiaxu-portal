import { Suspense } from "react"
import { LogsPanel } from "./logs-panel"

export const dynamic = "force-dynamic"

export default function LogsPage() {
  return (
    <main className="mx-auto max-w-6xl p-4 md:p-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-lg font-semibold text-zinc-200">生产日志</h1>
        <a href="/" className="text-xs text-zinc-500 hover:text-zinc-300">← 首页</a>
      </div>
      <Suspense fallback={<div className="text-sm text-zinc-500">加载中…</div>}>
        <LogsPanel />
      </Suspense>
    </main>
  )
}
