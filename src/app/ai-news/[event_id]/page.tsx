import Link from "next/link"
import { notFound } from "next/navigation"
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Clock3,
  ExternalLink,
  MessageCircle,
  Newspaper,
} from "lucide-react"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
  companyMeta,
  readEventById,
  type AINewsCategory,
  type AINewsEvent,
  type AINewsRelatedEvent,
} from "@/lib/ai-news-reader"

export const revalidate = 60
export const dynamic = "force-dynamic"

type PageProps = {
  params: Promise<{ event_id: string }>
}

const CATEGORY_LABELS: Record<AINewsCategory, string> = {
  product: "Product",
  model_release: "Model",
  api: "API",
  research: "Research",
  paper: "Paper",
  funding: "Funding",
  people: "People",
  infra: "Infra",
  security: "Security",
  outage: "Outage",
  pricing: "Pricing",
  controversy: "Controversy",
  policy: "Policy",
  community: "Community",
}

function scoreBadge(score: number) {
  let tone = "bg-zinc-700/60 text-zinc-300"
  if (score >= 13) tone = "bg-rose-500/30 text-rose-100"
  else if (score >= 10) tone = "bg-amber-500/25 text-amber-100"
  else if (score >= 7) tone = "bg-emerald-500/20 text-emerald-200"
  return (
    <span className={cn("shrink-0 rounded px-2 py-1 font-mono text-xs tabular-nums", tone)}>
      ⭐{score}
    </span>
  )
}

function fmtDateTime(iso?: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d)
}

function fmtShortDate(iso?: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${m}-${day}`
}

function sourceRows(event: AINewsEvent): Array<{ source: string; url: string }> {
  return (event.urls ?? []).map((url, idx) => ({
    url,
    source: event.sources?.[idx] || event.sources?.[0] || hostnameOrUrl(url),
  }))
}

function hostnameOrUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function Chip({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium",
        className,
      )}
    >
      {children}
    </span>
  )
}

function DetailSection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="border-t border-zinc-800 pt-5">
      <h2 className="flex items-center gap-2 text-sm font-medium text-zinc-200">
        {icon}
        {title}
      </h2>
      <div className="mt-2 text-sm leading-7 text-zinc-300">{children}</div>
    </section>
  )
}

function RelatedEventRow({ event }: { event: AINewsRelatedEvent }) {
  const meta = companyMeta(event.company)
  const date = fmtShortDate(event.published_at)
  return (
    <li>
      <Link
        href={`/ai-news/${event.id}`}
        className="flex items-center gap-2 rounded-lg border border-transparent px-2 py-2 hover:border-zinc-700 hover:bg-zinc-900/40"
      >
        {scoreBadge(event.importance_score)}
        <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
          {event.title_zh || event.title}
        </span>
        <span className="shrink-0 text-xs text-zinc-500">
          {meta.label}
          {date ? ` · ${date}` : ""}
        </span>
        <span className="shrink-0 text-zinc-500">→</span>
      </Link>
    </li>
  )
}

export default async function AINewsDetailPage({ params }: PageProps) {
  const { event_id } = await params
  const id = Number(event_id)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const data = await readEventById(id)
  if (!data) notFound()

  const event = data.event
  const title = event.title_zh || event.title
  const meta = companyMeta(event.company)
  const date = fmtDateTime(event.published_at)
  const rows = sourceRows(event)

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link
          href="/ai-news"
          className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200"
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </Link>
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-300">
          <Newspaper className="h-4 w-4" />
          AI News / 单条事件
        </div>
      </div>

      <Card className="border border-zinc-800 bg-zinc-950/50 text-zinc-100">
        <CardHeader className="gap-4 px-5 pt-5">
          <div className="flex flex-wrap items-center gap-2">
            {scoreBadge(event.importance_score)}
            <Chip className={meta.tone}>
              {meta.emoji} {meta.label}
            </Chip>
            <Chip className="border-zinc-700 bg-zinc-900/60 text-zinc-300">
              {CATEGORY_LABELS[event.category] ?? event.category}
            </Chip>
            {(date || event.is_first_seen_only) && (
              <Chip className="border-zinc-800 bg-zinc-900/40 text-zinc-500">
                <Clock3 className="h-3 w-3" />
                {event.is_first_seen_only ? (date ? `首见 ${date}` : "首见") : date}
              </Chip>
            )}
          </div>
          <div>
            <CardTitle className="text-2xl leading-tight text-zinc-50">{title}</CardTitle>
            {event.title && event.title !== title && (
              <p className="mt-2 text-sm leading-relaxed text-zinc-500">{event.title}</p>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-5 px-5 pb-6">
          {event.importance_reason && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm leading-6 text-zinc-300">
              <span className="mr-1 inline-flex items-center gap-1 font-medium text-zinc-200">
                📊 <BarChart3 className="h-4 w-4" />
              </span>
              {event.importance_reason}
            </div>
          )}

          {event.summary_zh && (
            <p className="text-base leading-8 text-zinc-200">{event.summary_zh}</p>
          )}

          {event.background_zh && (
            <DetailSection
              icon={
                <>
                  📖 <BookOpen className="h-4 w-4 text-zinc-400" />
                </>
              }
              title="背景"
            >
              {event.background_zh}
            </DetailSection>
          )}

          {event.hn_comments_summary_zh && (
            <DetailSection
              icon={
                <>
                  💬 <MessageCircle className="h-4 w-4 text-zinc-400" />
                </>
              }
              title="社区怎么看"
            >
              {event.hn_comments_summary_zh}
            </DetailSection>
          )}

          <DetailSection
            icon={
              <>
                🔗 <ExternalLink className="h-4 w-4 text-zinc-400" />
              </>
            }
            title={`原始链接 (${rows.length} 源)`}
          >
            {rows.length > 0 ? (
              <ul className="space-y-2">
                {rows.map((row, idx) => (
                  <li key={`${row.url}-${idx}`}>
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-w-0 items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/30 px-3 py-2 hover:border-zinc-700 hover:bg-zinc-900/60"
                    >
                      <span className="shrink-0 text-xs text-zinc-400">{row.source}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-500">
                        {row.url}
                      </span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-zinc-500">暂无原始链接</span>
            )}
          </DetailSection>

          {data.related_events.length > 0 && (
            <DetailSection
              icon={
                <>
                  🕐 <Clock3 className="h-4 w-4 text-zinc-400" />
                </>
              }
              title="关联事件"
            >
              <ul className="space-y-1">
                {data.related_events.map((related) => (
                  <RelatedEventRow key={related.id} event={related} />
                ))}
              </ul>
            </DetailSection>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
