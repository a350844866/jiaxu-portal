/**
 * StateHubCard — 个人状态汇聚(state-hub)卡片.
 *
 * Server component: 读 collector /v1/now(15min 窗口活跃度)+ /v1/daily(今日日报).
 * 端侧每 5min push;>12min 静默即 stale(设备睡眠 / VPN 关 / 无网),如实展示不装新鲜.
 */
import { Radar } from "lucide-react"
import { fetchStateNow, fetchStateDaily, type DeviceNow } from "@/lib/state-hub"
import { cn } from "@/lib/utils"

const DEVICE_LABEL: Record<string, string> = {
  "iphone-taieo": "iPhone",
  "mbp-taieo": "公司 MBP",
}

function netBadge(network: Record<string, number>): string {
  const entries = Object.entries(network).sort((a, b) => b[1] - a[1])
  if (!entries.length) return "无流量"
  const main = entries[0][0]
  if (main === "cellular") return "蜂窝 · 在外"
  if (main === "wifi") return "WiFi"
  return main
}

function DeviceRow({ id, d }: { id: string; d: DeviceNow }) {
  const fresh = d.reporting === "fresh"
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span
        className={cn(
          "h-2 w-2 flex-shrink-0 rounded-full",
          fresh ? "bg-emerald-400" : "bg-rose-400",
        )}
        title={fresh ? "5min 周期正常上报" : `已静默 ${d.silent_minutes ?? "?"} 分钟`}
      />
      <span className="w-16 font-medium text-zinc-200">{DEVICE_LABEL[id] ?? id}</span>
      {fresh ? (
        <>
          <span className="text-zinc-400">{netBadge(d.network)}</span>
          <span className="text-zinc-500">{d.window_min}min 内 {d.requests} 请求</span>
          <span className="min-w-0 flex-1 truncate text-zinc-400">
            {d.top.length
              ? d.top.slice(0, 4).map((t) => t.domain).join(" · ")
              : "静置(仅后台噪声)"}
          </span>
        </>
      ) : (
        <span className="text-zinc-500">
          静默 {d.silent_minutes != null ? Math.round(d.silent_minutes) : "?"} 分钟
          (睡眠 / VPN 关 / 无网),末次 {d.last_report_beijing?.slice(5, 16) ?? "—"}
        </span>
      )}
    </div>
  )
}

export async function StateHubCard() {
  const [now, daily] = await Promise.all([fetchStateNow(), fetchStateDaily()])

  if (!now.ok) {
    return (
      <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4 text-sm">
        <header className="flex items-center gap-2 text-zinc-300">
          <Radar className="h-4 w-4 text-zinc-400" />
          <span className="font-medium">个人状态</span>
        </header>
        <div className="mt-2 text-xs text-rose-400">{now.error}</div>
      </section>
    )
  }

  const devices = Object.entries(now.data.devices ?? {})

  return (
    <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/40">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between p-4 hover:bg-zinc-900/30">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-2">
              <Radar className="h-4 w-4 text-sky-400" />
              <span className="text-sm font-medium text-zinc-200">个人状态</span>
              <span className="text-xs text-zinc-500">state-hub</span>
            </div>
            {now.data.person?.available && now.data.person.summary && (
              <div className="text-xs text-sky-200/90">
                📍 {now.data.person.summary}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              {devices.map(([id, d]) => (
                <DeviceRow key={id} id={id} d={d} />
              ))}
            </div>
          </div>
          <div className="ml-3 flex-shrink-0 text-xs text-zinc-600">
            <span className="group-open:hidden">今日 ▾</span>
            <span className="hidden group-open:inline">收起 ▴</span>
          </div>
        </summary>

        <div className="px-4 pb-4">
          {!daily.ok ? (
            <div className="text-xs text-rose-400">{daily.error}</div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {Object.entries(daily.data.devices ?? {}).map(([id, d]) => (
                <div key={id} className="rounded-lg border border-zinc-800/60 p-3">
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <span className="text-xs font-medium text-zinc-200">
                      {DEVICE_LABEL[id] ?? id} · 今日
                    </span>
                    <span className="text-[10px] text-zinc-500">
                      {d.first_beijing?.slice(11, 16)} → {d.last_beijing?.slice(11, 16)} ·
                      活跃 {d.active_minutes}min · {d.mb}MB
                    </span>
                  </div>
                  <ul className="space-y-0.5">
                    {d.top.slice(0, 8).map((t) => (
                      <li key={t.domain} className="flex items-baseline gap-2 text-xs">
                        <span className="min-w-0 flex-1 truncate text-zinc-300">{t.domain}</span>
                        <span className="flex-shrink-0 font-mono text-[10px] text-zinc-500">
                          {t.requests}
                        </span>
                      </li>
                    ))}
                    {!d.top.length && <li className="text-xs text-zinc-500">今日暂无非噪声请求</li>}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </details>
    </section>
  )
}
