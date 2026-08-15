/**
 * CardSkeleton — 首页各 async 卡片的 Suspense 占位。
 *
 * 沿用卡片统一外壳(mt-6 rounded-2xl border-zinc-800 bg-zinc-950/40),
 * 让流式填充时的布局跳动尽量小。
 */
export function CardSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <section className="mt-6 animate-pulse rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="h-4 w-32 rounded bg-zinc-800" />
      <div className="mt-3 space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="h-3 rounded bg-zinc-900" />
        ))}
      </div>
    </section>
  )
}
