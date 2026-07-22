import Link from "next/link"
import { readPmPaperDetail } from "@/lib/pm-paper-detail-reader"
import { readEventLane } from "@/lib/pm-paper-event-reader"
import { EventLanePanel } from "@/components/dashboard/pm-paper/event-lane-panel"
import { StatusHeader } from "@/components/dashboard/pm-paper/status-header"
import { OpenOrdersTable, PositionsTable } from "@/components/dashboard/pm-paper/orders-positions-table"
import { PredictionsTable } from "@/components/dashboard/pm-paper/predictions-table"
import { SettlementsTable } from "@/components/dashboard/pm-paper/settlements-table"
import { CalibrationTable } from "@/components/dashboard/pm-paper/calibration-table"

export const dynamic = "force-dynamic"

function ageText(sec: number | null): string {
  if (sec == null) return "—"
  if (sec < 60) return `${sec}s 前`
  if (sec < 3600) return `${Math.floor(sec / 60)}min 前`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h 前`
  return `${Math.floor(sec / 86400)}d 前`
}

export default async function PmPaperPage() {
  const [detail, eventLane] = await Promise.all([readPmPaperDetail(), readEventLane()])

  if (detail.bootstrapping) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-6">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 text-sm text-zinc-400">
          实验第0周,等待首轮数据(selector/predictor 还没跑完)
          <div className="mt-3">
            <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300">← 返回首页</Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="relative min-h-screen space-y-6 bg-zinc-950 p-4 sm:p-6 lg:p-8">
      {/* 氛围光晕:琥珀(P&L 结算)+ 青(挂单/校准),与 serenity/ai-chain 看板同语言 */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 left-[18%] h-96 w-96 rounded-full bg-amber-500/[0.05] blur-3xl" />
        <div className="absolute top-1/2 right-[10%] h-[28rem] w-[28rem] rounded-full bg-emerald-500/[0.03] blur-3xl" />
      </div>

      <header className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-xl font-bold text-zinc-50">pm-paper 模拟盘</h1>
          <span className="text-xs text-zinc-500">
            Polymarket paper-trading · {detail.universeCount ?? 0} 盘 universe · 更新于 {ageText(detail.ageSeconds)}
          </span>
          <Link href="/" className="ml-auto text-xs text-zinc-500 hover:text-zinc-300">← 返回首页</Link>
        </div>
        <p className="max-w-3xl text-sm leading-6 text-zinc-400">
          Claude 预测 + 模拟 maker 挂单,验证"结构化预测 + 纪律执行"能否在政治/宏观数据类
          Polymarket 盘口跑出正 P&amp;L。全部虚拟资金,不涉真实交易。
        </p>
      </header>

      <StatusHeader detail={detail} />

      <EventLanePanel lane={eventLane} />

      <div className="grid gap-4 lg:grid-cols-2">
        <OpenOrdersTable rows={detail.openOrders} />
        <PositionsTable rows={detail.positions} />
      </div>

      <PredictionsTable rows={detail.predictions} />
      <SettlementsTable rows={detail.settlements} />
      <CalibrationTable buckets={detail.calibration} />

      <footer className="pb-4 text-center text-[11px] text-zinc-600">
        数据:家服 /data/pm-paper/state(cron 驱动:selector → predictor → executor → settler)· 仅模拟研究,非投资建议
      </footer>
    </main>
  )
}
