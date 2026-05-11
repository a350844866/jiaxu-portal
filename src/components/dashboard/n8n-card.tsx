import { Workflow, ExternalLink, CheckCircle2, XCircle, CircleAlert } from "lucide-react"
import { readSnapshot } from "@/lib/n8n-client"

export async function N8nCard() {
  const snap = await readSnapshot()

  const dotColor = snap.ok
    ? "bg-emerald-500"
    : snap.configured
    ? "bg-amber-500"
    : "bg-zinc-600"

  return (
    <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4 text-sm">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${dotColor}`} />
          <Workflow className="h-4 w-4 text-zinc-300" />
          <span className="text-sm font-medium text-zinc-200">n8n</span>
          <span className="text-xs text-zinc-500">workflow 自动化</span>
        </div>
        <a
          href={snap.publicUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300"
        >
          打开 <ExternalLink className="h-3 w-3" />
        </a>
      </header>

      {!snap.configured ? (
        <div className="mt-3 text-xs text-zinc-500">
          {snap.error || "未配置 N8N_API_KEY"} — 首次访问{" "}
          <a
            href={snap.publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-400 underline hover:text-zinc-200"
          >
            n8n.liulin.work
          </a>{" "}
          建管理员账号 → Settings → n8n API → Create API Key → 填入 portal .env 重启
        </div>
      ) : !snap.reachable ? (
        <div className="mt-3 text-xs text-amber-400">
          <CircleAlert className="mr-1 inline h-3 w-3" />
          n8n API 不可达: {snap.error || "unknown"}
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Workflows" value={snap.workflowsTotal} sub={`${snap.workflowsActive} active`} />
          <Stat label="24h 执行" value={snap.execsLast24h} />
          <Stat
            label="成功"
            value={snap.execsSuccess24h}
            icon={<CheckCircle2 className="h-3 w-3 text-emerald-400" />}
          />
          <Stat
            label="失败"
            value={snap.execsFailed24h}
            icon={<XCircle className="h-3 w-3 text-rose-400" />}
            tone={snap.execsFailed24h > 0 ? "warn" : "default"}
          />
        </div>
      )}
    </section>
  )
}

function Stat({
  label,
  value,
  sub,
  icon,
  tone,
}: {
  label: string
  value: number
  sub?: string
  icon?: React.ReactNode
  tone?: "default" | "warn"
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-zinc-500">
        {icon}
        {label}
      </div>
      <div
        className={`mt-1 text-lg font-medium ${
          tone === "warn" ? "text-rose-300" : "text-zinc-100"
        }`}
      >
        {value}
      </div>
      {sub && <div className="text-[10px] text-zinc-500">{sub}</div>}
    </div>
  )
}
