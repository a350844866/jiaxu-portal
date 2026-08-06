/**
 * trademax-observer dashboard panels (server components, no client state).
 *
 * Design intent: the account's headline number (+69% in 3 days) is the least
 * informative thing about it. Every panel here is arranged so the *shape* of
 * the edge — tiny locked-in wins vs a handful of runners, a 200-trade sample
 * bar that is nowhere near full — is at least as loud as the P&L.
 */
import type {
  Bucket, ConcurrencyCheck, DayStat, Deal, EquityCurve, LiveEvent,
  PendingOrder, Performance, RiskProfile, Rule, StopStructure, TimingStats,
  OpenPosition, EntryAnalysis,
} from "@/lib/trademax-pure"
import { cn } from "@/lib/utils"

// ── formatting helpers ────────────────────────────────────────────────────

export function usd(n: number | null | undefined, sign = true): string {
  if (n == null || Number.isNaN(n)) return "—"
  const s = sign && n > 0 ? "+" : ""
  return `${s}$${n.toFixed(2)}`
}

export function pct(n: number | null | undefined, digits = 1, sign = true): string {
  if (n == null || Number.isNaN(n)) return "—"
  const s = sign && n > 0 ? "+" : ""
  return `${s}${(n * 100).toFixed(digits)}%`
}

export function num(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—"
  return n.toFixed(digits)
}

export function ageText(sec: number | null): string {
  if (sec == null) return "—"
  if (sec < 60) return `${sec}s 前`
  if (sec < 3600) return `${Math.floor(sec / 60)}min 前`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h 前`
  return `${Math.floor(sec / 86400)}d 前`
}

function Panel({ title, hint, children, className }: {
  title: string; hint?: string; children: React.ReactNode; className?: string
}) {
  return (
    <section className={cn("rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 sm:p-5", className)}>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>
        {hint && <span className="text-[11px] leading-5 text-zinc-500">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

function Tile({ label, value, sub, tone = "neutral" }: {
  label: string
  value: string
  sub?: string
  tone?: "neutral" | "good" | "bad" | "warn"
}) {
  const toneCls = {
    neutral: "text-zinc-100",
    good: "text-emerald-400",
    bad: "text-rose-400",
    warn: "text-amber-400",
  }[tone]
  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 px-3 py-2.5">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className={cn("mt-0.5 text-lg font-semibold tabular-nums", toneCls)}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] leading-4 text-zinc-600">{sub}</div>}
    </div>
  )
}

// ── 1. header / vitals ────────────────────────────────────────────────────

export function Vitals({ account, perf, equity, watch, openPositions }: {
  account: {
    login: string; server: string; broker: string; deposit: number
    balance: number | null; netPnl: number; returnPct: number | null
    fundedBy: string | null; firstDeal: string | null; lastDeal: string | null
  }
  perf: Performance
  equity: EquityCurve
  watch: { stale: boolean; ageSeconds: number | null; polls: number | null; heartbeat: string | null }
  openPositions: OpenPosition[]
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
          watch.stale
            ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
            : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
        )}>
          <span className={cn("h-1.5 w-1.5 rounded-full", watch.stale ? "bg-amber-400" : "bg-emerald-400 animate-pulse")} />
          {watch.stale ? "抓取器失联" : "会话在线"} · 心跳 {ageText(watch.ageSeconds)}
          {watch.polls != null && ` · ${watch.polls} 次轮询`}
        </span>
        <span className="rounded-full border border-zinc-800 bg-zinc-950/60 px-2.5 py-1 text-zinc-400">
          {account.login} @ {account.server}
        </span>
        <span className="rounded-full border border-zinc-800 bg-zinc-950/60 px-2.5 py-1 text-zinc-500">
          {account.broker}
        </span>
        <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-sky-300">
          观摩(只读)· 不是我们的钱
        </span>
        {openPositions.length > 0 && (
          <span className="rounded-full border border-violet-500/40 bg-violet-500/10 px-2.5 py-1 text-violet-300">
            持仓 {openPositions.length}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="当前余额" value={usd(account.balance, false)}
              sub={`入金 ${usd(account.deposit, false)}`} />
        <Tile label="净盈亏" value={usd(account.netPnl)}
              tone={account.netPnl >= 0 ? "good" : "bad"} sub={pct(account.returnPct)} />
        <Tile label="成交笔数" value={String(perf.n)}
              sub={account.firstDeal ? `自 ${account.firstDeal.slice(0, 10)}` : undefined} />
        <Tile label="胜率" value={pct(perf.winRate, 1, false)}
              sub={`${perf.wins} 胜 / ${perf.losses} 负`} />
        <Tile label="盈亏比" value={num(perf.payoff)} tone={(perf.payoff ?? 0) < 1 ? "warn" : "neutral"}
              sub={`均盈 ${usd(perf.avgWin)} / 均亏 ${usd(perf.avgLoss)}`} />
        <Tile label="最大回撤" value={pct(equity.maxDrawdownPct, 1, false)}
              tone="warn" sub={usd(-equity.maxDrawdown, false)} />
      </div>

      {account.fundedBy && (
        <p className="text-[11px] leading-5 text-zinc-500">
          入金备注 <code className="rounded bg-zinc-800/60 px-1 py-0.5 text-zinc-300">{account.fundedBy}</code>
          {" "}—— 由卖方从另一个 TMGM 账户内部转账注资，账户属托管/跟单性质。
        </p>
      )}
    </div>
  )
}

// ── 2. equity curve ───────────────────────────────────────────────────────

export function EquityChart({ equity }: { equity: EquityCurve }) {
  const pts = equity.points
  if (pts.length < 2) {
    return <Panel title="资金曲线"><p className="text-xs text-zinc-500">成交太少，画不出曲线。</p></Panel>
  }
  const W = 1000
  const H = 220
  const PAD = 8
  const lo = Math.min(equity.trough, equity.start)
  const hi = Math.max(equity.peak, equity.start)
  const span = hi - lo || 1
  const x = (i: number) => PAD + (i / (pts.length - 1)) * (W - PAD * 2)
  const y = (v: number) => PAD + (1 - (v - lo) / span) * (H - PAD * 2)
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(" ")
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${y(lo).toFixed(1)} L${x(0).toFixed(1)},${y(lo).toFixed(1)} Z`
  const peakIdx = pts.findIndex((p) => p.balance === equity.peak)

  return (
    <Panel title="资金曲线（按平仓时刻）"
           hint={`起 ${usd(equity.start, false)} → 终 ${usd(equity.end, false)}，峰值 ${usd(equity.peak, false)}，最大回撤 ${usd(-equity.maxDrawdown, false)}（${pct(equity.maxDrawdownPct, 1, false)}）`}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-48 w-full sm:h-56" preserveAspectRatio="none" role="img"
           aria-label="账户余额随成交推进的变化">
        <defs>
          <linearGradient id="tmEq" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(52 211 153)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="rgb(52 211 153)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* deposit baseline — anything below this line is losing the sponsor money */}
        <line x1={PAD} x2={W - PAD} y1={y(equity.start)} y2={y(equity.start)}
              stroke="rgb(113 113 122)" strokeDasharray="4 4" strokeWidth="1" />
        <path d={area} fill="url(#tmEq)" />
        <path d={line} fill="none" stroke="rgb(52 211 153)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {peakIdx >= 0 && (
          <circle cx={x(peakIdx)} cy={y(equity.peak)} r="3.5" fill="rgb(251 191 36)" />
        )}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-zinc-600">
        <span>入金基线 {usd(equity.start, false)}</span>
        <span className="text-amber-500/80">● 峰值 {usd(equity.peak, false)}</span>
      </div>
    </Panel>
  )
}

// ── 3. where the money came from ──────────────────────────────────────────

export function MoneySource({ exits, stops }: { exits: Bucket[]; stops: StopStructure }) {
  const max = Math.max(1, ...exits.map((b) => Math.abs(b.sum)))
  return (
    <Panel title="钱是从哪来的"
           hint="83% 的胜率主要是保本位在扫单；真正的钱来自少数几笔让利润跑的单">
      <div className="space-y-2.5">
        {exits.map((b) => {
          const w = (Math.abs(b.sum) / max) * 100
          const good = b.sum >= 0
          return (
            <div key={b.key}>
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-zinc-300">{b.label}</span>
                <span className="tabular-nums text-zinc-500">
                  {b.n} 笔 · 均 {usd(b.avg)} ·{" "}
                  <span className={good ? "text-emerald-400" : "text-rose-400"}>{usd(b.sum)}</span>
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-800/60">
                <div className={cn("h-full rounded-full", good ? "bg-emerald-500/70" : "bg-rose-500/70")}
                     style={{ width: `${w}%` }} />
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-3 rounded-lg border border-zinc-800/80 bg-zinc-950/40 px-3 py-2 text-[11px] leading-5 text-zinc-400">
        止损位出场的 {stops.slExitsTotal} 笔里有 <span className="text-emerald-400">{stops.slExitsProfitable} 笔是赚钱的</span>
        ——那是保本位被扫，不是亏损。把这批算进「胜率」，胜率就好看了，但它们每笔只有几美元。
      </p>
    </Panel>
  )
}

// ── 4. reverse-engineered rules ───────────────────────────────────────────

const CONF_STYLE = {
  high: { label: "高", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  medium: { label: "中", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  unknown: { label: "未知", cls: "border-zinc-600/50 bg-zinc-700/20 text-zinc-400" },
} as const

export function RulesTable({ rules }: { rules: Rule[] }) {
  return (
    <Panel title="反推出的规则集"
           hint="全部由订单元数据推出；证据栏的数字随数据实时重算，不会和上面的统计脱节">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="text-[11px] text-zinc-500">
            <tr className="border-b border-zinc-800">
              <th className="w-8 pb-2 font-normal">#</th>
              <th className="pb-2 font-normal">规则</th>
              <th className="pb-2 font-normal">证据</th>
              <th className="w-14 pb-2 text-right font-normal">置信</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70">
            {rules.map((r) => {
              const c = CONF_STYLE[r.confidence]
              return (
                <tr key={r.id} className={r.confidence === "unknown" ? "opacity-80" : undefined}>
                  <td className="py-2 align-top tabular-nums text-zinc-600">{r.id}</td>
                  <td className="py-2 pr-3 align-top text-zinc-200">{r.rule}</td>
                  <td className="py-2 pr-3 align-top leading-5 text-zinc-500">{r.evidence}</td>
                  <td className="py-2 text-right align-top">
                    <span className={cn("rounded-full border px-1.5 py-0.5 text-[10px]", c.cls)}>{c.label}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

// ── 5. stop structure ─────────────────────────────────────────────────────

export function StopPanel({ stops }: { stops: StopStructure }) {
  const max = Math.max(1, ...stops.offsetHistogram.map((h) => h.n))
  return (
    <Panel title="止损结构：初始风险 vs 保本锁利"
           hint="横轴 = 平仓时的止损相对开仓价的位置（美元/盎司），负=还在亏损侧（原始保护性止损），正=已挪到盈利侧">
      <div className="flex h-40 items-end gap-[3px] overflow-x-auto">
        {stops.offsetHistogram.map((h) => {
          const isLock = stops.lockLevel != null && Math.abs(h.bucket - stops.lockLevel) < 0.26
          return (
            <div key={h.bucket} className="flex min-w-[14px] flex-1 flex-col items-center gap-1">
              <span className="text-[10px] tabular-nums text-zinc-600">{h.n || ""}</span>
              <div
                className={cn("w-full rounded-t", isLock ? "bg-amber-400/80" : h.bucket < 0 ? "bg-rose-500/60" : "bg-emerald-500/50")}
                style={{ height: `${Math.max(2, (h.n / max) * 100)}%` }}
                title={`${h.bucket >= 0 ? "+" : ""}${h.bucket} → ${h.n} 笔`}
              />
              <span className="text-[9px] tabular-nums text-zinc-600">{h.bucket}</span>
            </div>
          )
        })}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <Tile label="锁利硬档位" value={stops.lockLevel != null ? `+$${stops.lockLevel.toFixed(2)}` : "—"}
              tone="warn" sub={`${stops.lockLevelCount} 笔精确落在这一档`} />
        <Tile label="初始止损（中位）" value={stops.medianInitialStop != null ? `$${stops.medianInitialStop.toFixed(2)}/oz` : "—"}
              sub={stops.medianRiskUsd != null ? `≈ ${usd(stops.medianRiskUsd, false)} / 笔` : undefined} />
        <Tile label="止损已移到盈利侧" value={`${stops.movedToProfit} / ${stops.movedToProfit + stops.stillProtective}`}
              sub={`其余 ${stops.stillProtective} 笔是被原始止损打掉的`} />
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2 text-[11px] leading-5 text-zinc-400">
          <span className="text-zinc-300">带止盈的 {stops.withTp} 笔</span>：合计{" "}
          <span className="text-rose-400">{usd(stops.withTpPnl)}</span>
          {stops.medianTpDistance != null && <> · TP 距离中位 ${stops.medianTpDistance.toFixed(2)}</>}
        </div>
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2 text-[11px] leading-5 text-zinc-400">
          <span className="text-zinc-300">已撤掉止盈的 {stops.withoutTp} 笔</span>：合计{" "}
          <span className="text-emerald-400">{usd(stops.withoutTpPnl)}</span> —— 进盈利模式后改跑移动止损
        </div>
      </div>
    </Panel>
  )
}

// ── 6. per-day ────────────────────────────────────────────────────────────

export function DayTable({ days }: { days: DayStat[] }) {
  const max = Math.max(1, ...days.map((d) => Math.abs(d.pnl)))
  return (
    <Panel title="按日表现（北京时间）" hint="利润高度集中在少数几天，这本身就是样本不足的证据">
      <div className="space-y-2">
        {days.map((d) => (
          <div key={d.date} className="flex items-center gap-3 text-xs">
            <span className="w-20 shrink-0 tabular-nums text-zinc-400">{d.date.slice(5)}</span>
            <span className="w-24 shrink-0 tabular-nums text-zinc-600">{d.wins}/{d.n} 胜</span>
            <div className="relative h-2 flex-1 rounded-full bg-zinc-800/60">
              <div className={cn("absolute top-0 h-full rounded-full", d.pnl >= 0 ? "left-1/2 bg-emerald-500/70" : "right-1/2 bg-rose-500/70")}
                   style={{ width: `${(Math.abs(d.pnl) / max) * 50}%` }} />
              <div className="absolute left-1/2 top-[-3px] h-[14px] w-px bg-zinc-700" />
            </div>
            <span className={cn("w-20 shrink-0 text-right tabular-nums", d.pnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
              {usd(d.pnl)}
            </span>
            <span className="w-20 shrink-0 text-right tabular-nums text-zinc-500">{usd(d.balanceEnd, false)}</span>
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ── 7. timing ─────────────────────────────────────────────────────────────

export function TimingPanel({ timing: tm, concurrency: conc }: { timing: TimingStats; concurrency: ConcurrencyCheck }) {
  const max = Math.max(1, ...tm.hourly)
  return (
    <Panel title="节奏：开仓时刻 / 持仓时长 / 并发"
           hint="北京时间。凌晨照样开仓 + 持仓分钟级 = 机器在跑，不是人手">
      <div className="flex h-28 items-end gap-[2px]">
        {tm.hourly.map((n, h) => (
          <div key={h} className="flex flex-1 flex-col items-center gap-1">
            <div className={cn("w-full rounded-t", n ? "bg-sky-500/60" : "bg-zinc-800/50")}
                 style={{ height: `${Math.max(2, (n / max) * 100)}%` }}
                 title={`${String(h).padStart(2, "0")}:00 北京 → ${n} 笔`} />
            <span className="text-[9px] tabular-nums text-zinc-600">{h % 3 === 0 ? h : ""}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {tm.sessions.map((s) => <Tile key={s.label} label={s.label} value={String(s.n)} />)}
        <Tile label="持仓中位" value={tm.medianHoldMin != null ? `${tm.medianHoldMin.toFixed(1)} 分钟` : "—"}
              sub={tm.holdBuckets.map((b) => `${b.label} ${b.n}`).join(" / ")} />
      </div>
      <p className="mt-3 rounded-lg border border-zinc-800/80 bg-zinc-950/40 px-3 py-2 text-[11px] leading-5 text-zinc-400">
        并发检查：真重叠 <span className={conc.oneAtATime ? "text-emerald-400" : "text-rose-400"}>{conc.trueOverlaps}</span> 组，
        另有 {conc.partialLegOverlaps} 组「重叠」是同一决策被部分平仓拆成的母/子腿 →{" "}
        <span className="text-zinc-200">{conc.oneAtATime ? "「一次一单」属实" : "存在真并发，与宣传不符"}</span>
        （去掉拆腿后实际决策数 ≈ {conc.decisions}）。
        {tm.medianGapMin != null && <> 两笔之间间隔中位 {tm.medianGapMin.toFixed(1)} 分钟。</>}
      </p>
    </Panel>
  )
}

// ── 8. risk ───────────────────────────────────────────────────────────────

export function RiskPanel({ risk, perf, equity }: { risk: RiskProfile; perf: Performance; equity: EquityCurve }) {
  const p = risk.sampleProgress
  return (
    <Panel title="风险标尺" hint="收益率好看的时候，这一栏才是该看的">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="名义杠杆（对当前余额）" value={risk.leverage != null ? `${risk.leverage.toFixed(0)}×` : "—"}
              tone="warn"
              sub={`单笔名义 ${usd(risk.notionalPerTrade, false)}` +
                   (risk.leverageOnDeposit != null ? ` · 起始本金口径 ${risk.leverageOnDeposit.toFixed(0)}×` : "")} />
        <Tile label="单笔风险（对当前余额）" value={risk.riskPerTradePct != null ? pct(risk.riskPerTradePct, 1, false) : "—"}
              tone="warn"
              sub={`${usd(risk.riskPerTradeUsd, false)}` +
                   (risk.riskPctOnDeposit != null ? ` · 起始本金口径 ${(risk.riskPctOnDeposit * 100).toFixed(1)}%` : "")} />
        <Tile label="Profit factor" value={num(perf.profitFactor)}
              sub={`总盈 ${usd(perf.grossWin, false)} / 总亏 ${usd(perf.grossLoss, false)}`} />
        <Tile label="每笔期望" value={usd(perf.expectancy)}
              tone={(perf.expectancy ?? 0) > 0 ? "good" : "bad"} sub={`最长连亏 ${perf.maxLossStreak} 笔`} />
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-zinc-300">样本量进度</span>
          <span className="tabular-nums text-zinc-500">{p.have} / {p.need} 笔</span>
        </div>
        <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-zinc-800/60">
          <div className="h-full rounded-full bg-gradient-to-r from-amber-500/80 to-emerald-500/80"
               style={{ width: `${p.pct * 100}%` }} />
        </div>
        <p className="mt-1.5 text-[11px] leading-5 text-zinc-500">
          在 {p.need} 笔并跨过不同行情之前，这套东西是不是正期望<span className="text-zinc-300">无法判断</span>。当前 profit factor 与胜率都在样本噪声范围内。
        </p>
      </div>

      {risk.lossStreakLadder.length > 0 && (
        <div className="mt-4">
          <div className="text-xs text-zinc-300">按当前单笔风险，连续吃止损的后果</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {risk.lossStreakLadder.map((l) => (
              <div key={l.n} className="rounded-lg border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2">
                <div className="text-[11px] text-zinc-500">连亏 {l.n} 笔</div>
                <div className="mt-0.5 text-sm font-semibold tabular-nums text-rose-300">
                  {usd(l.balance, false)} <span className="text-[11px] font-normal text-rose-400/80">{pct(l.pct)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-4 text-[11px] leading-5 text-zinc-500">
        已实测最大回撤 {usd(-equity.maxDrawdown, false)}（{pct(equity.maxDrawdownPct, 1, false)}）；
        手数分布 {risk.lotDistribution.map((l) => `${l.size}×${l.n}`).join(" / ")}
        {risk.lotsConstant
          ? "，全程未随余额上调 → 无复利、无马丁。"
          : `，其中 ${risk.oversizedFills} 笔超过基准手数——不是纯固定手数，值得盯。`}
      </p>
    </Panel>
  )
}

// ── 9. live feed ──────────────────────────────────────────────────────────

const KIND_STYLE: Record<LiveEvent["kind"], { label: string; cls: string }> = {
  open: { label: "开仓", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  close: { label: "平仓", cls: "border-violet-500/40 bg-violet-500/10 text-violet-300" },
  "sl-move": { label: "移损", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  "tp-move": { label: "改止盈", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  flat: { label: "空仓", cls: "border-zinc-700 bg-zinc-800/40 text-zinc-500" },
  other: { label: "浮动", cls: "border-zinc-700 bg-zinc-800/40 text-zinc-500" },
}

export function LiveFeed({ live, openPositions }: { live: LiveEvent[]; openPositions: OpenPosition[] }) {
  return (
    <Panel title="实时会话流"
           hint="历史表只留最终止损值，推不出触发条件；常驻会话每 10s 采样一次持仓行，移损/撤 TP 的瞬间才抓得到">
      {openPositions.length > 0 ? (
        <div className="mb-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead className="text-[11px] text-zinc-500">
              <tr className="border-b border-zinc-800">
                <th className="pb-1.5 font-normal">单号</th><th className="pb-1.5 font-normal">方向</th>
                <th className="pb-1.5 font-normal">手数</th><th className="pb-1.5 font-normal">开仓价</th>
                <th className="pb-1.5 font-normal">止损</th><th className="pb-1.5 font-normal">止盈</th>
                <th className="pb-1.5 text-right font-normal">浮动盈亏</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {openPositions.map((p) => (
                <tr key={p.ticket}>
                  <td className="py-1.5 tabular-nums text-zinc-500">{p.ticket}</td>
                  <td className={cn("py-1.5", p.type === "buy" ? "text-emerald-400" : "text-rose-400")}>{p.type}</td>
                  <td className="py-1.5 tabular-nums text-zinc-300">{p.size}</td>
                  <td className="py-1.5 tabular-nums text-zinc-300">{p.openPrice}</td>
                  <td className="py-1.5 tabular-nums text-amber-300">{p.sl ?? "—"}</td>
                  <td className="py-1.5 tabular-nums text-zinc-400">{p.tp ?? "—"}</td>
                  <td className={cn("py-1.5 text-right tabular-nums", (p.profit ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                    {usd(p.profit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mb-3 text-xs text-zinc-500">当前空仓。</p>
      )}

      <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
        {live.length === 0 && <p className="text-xs text-zinc-600">还没有采到变化事件。</p>}
        {live.map((e, i) => {
          const s = KIND_STYLE[e.kind]
          return (
            <div key={`${e.t}-${i}`} className="flex items-baseline gap-2 rounded-lg border border-zinc-800/60 bg-zinc-950/30 px-2.5 py-1.5 text-[11px]">
              <span className="shrink-0 tabular-nums text-zinc-600">{e.t.slice(11, 19)}</span>
              <span className={cn("shrink-0 rounded-full border px-1.5 py-0.5 text-[10px]", s.cls)}>{s.label}</span>
              <span className="text-zinc-400">{e.note}</span>
              {e.bar.equity != null && (
                <span className="ml-auto shrink-0 tabular-nums text-zinc-600">权益 {usd(e.bar.equity, false)}</span>
              )}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

// ── 10. anomalies ─────────────────────────────────────────────────────────

export function AnomalyPanel({ pending }: { pending: PendingOrder[] }) {
  if (pending.length === 0) return null
  return (
    <Panel title="异常单（未成交）" hint="这些单不参与盈亏统计，但它们透露账户是被什么东西在操作">
      <div className="space-y-2">
        {pending.map((p) => (
          <div key={p.ticket} className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-[11px] leading-5 text-zinc-400">
            <span className="tabular-nums text-zinc-300">#{p.ticket}</span>{" "}
            <span className="text-amber-300">{p.type} {p.size} 手 @ {p.price}</span>{" "}
            · 下单 {p.placedTime}{p.cancelledTime && ` · 撤单 ${p.cancelledTime}`}
            {p.comment && <> · 备注 <code className="rounded bg-zinc-800/60 px-1 py-0.5 text-zinc-300">{p.comment}</code></>}
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ── 11. deals table ───────────────────────────────────────────────────────

function dealTag(d: Deal, lockLevel: number | null): { label: string; cls: string } {
  if (d.profit < 0) return { label: "亏", cls: "border-rose-500/40 bg-rose-500/10 text-rose-300" }
  if (d.exit === "sl" && lockLevel != null && d.slOffset != null && Math.abs(d.slOffset - lockLevel) < 0.26) {
    return { label: "保本位", cls: "border-zinc-600/50 bg-zinc-700/20 text-zinc-400" }
  }
  if (d.exit === "tp") return { label: "止盈", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" }
  if (d.isPartialParent) return { label: "分批", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" }
  return { label: "赢", cls: "border-emerald-500/30 bg-emerald-500/[0.07] text-emerald-400/90" }
}

export function DealsTable({ deals, lockLevel }: { deals: Deal[]; lockLevel: number | null }) {
  const rows = [...deals].reverse()
  return (
    <Panel title={`成交明细（${deals.length} 笔，最近在上）`}
           hint="「保本位」= 被 +锁利档 扫掉的小额盈利单，它们撑起了胜率但几乎不贡献利润">
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full min-w-[820px] text-left text-xs">
          <thead className="sticky top-0 bg-zinc-900/95 text-[11px] text-zinc-500 backdrop-blur">
            <tr className="border-b border-zinc-800">
              <th className="py-2 font-normal">单号</th>
              <th className="py-2 font-normal">开仓（服务器时间）</th>
              <th className="py-2 font-normal">方向</th>
              <th className="py-2 font-normal">手数</th>
              <th className="py-2 font-normal">开仓价</th>
              <th className="py-2 font-normal">止损</th>
              <th className="py-2 font-normal">止盈</th>
              <th className="py-2 font-normal">平仓价</th>
              <th className="py-2 font-normal">持仓</th>
              <th className="py-2 text-right font-normal">盈亏</th>
              <th className="py-2 pl-2 font-normal">类型</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {rows.map((d) => {
              const tag = dealTag(d, lockLevel)
              return (
                <tr key={d.ticket} className="hover:bg-zinc-800/25">
                  <td className="py-1.5 tabular-nums text-zinc-600">{d.ticket}</td>
                  <td className="py-1.5 tabular-nums text-zinc-400">{d.openTime}</td>
                  <td className={cn("py-1.5", d.type === "buy" ? "text-emerald-400" : "text-rose-400")}>{d.type}</td>
                  <td className="py-1.5 tabular-nums text-zinc-300">{d.size.toFixed(2)}</td>
                  <td className="py-1.5 tabular-nums text-zinc-300">{d.openPrice.toFixed(2)}</td>
                  <td className="py-1.5 tabular-nums text-amber-300/90">
                    {d.sl?.toFixed(2) ?? "—"}
                    {d.slOffset != null && (
                      <span className="ml-1 text-[10px] text-zinc-600">
                        ({d.slOffset >= 0 ? "+" : ""}{d.slOffset.toFixed(2)})
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 tabular-nums text-zinc-500">{d.tp?.toFixed(2) ?? "—"}</td>
                  <td className="py-1.5 tabular-nums text-zinc-300">{d.closePrice?.toFixed(2) ?? "—"}</td>
                  <td className="py-1.5 tabular-nums text-zinc-500">
                    {d.holdMin != null ? `${d.holdMin.toFixed(0)}m` : "—"}
                  </td>
                  <td className={cn("py-1.5 text-right tabular-nums", d.profit >= 0 ? "text-emerald-400" : "text-rose-400")}>
                    {usd(d.profit)}
                  </td>
                  <td className="py-1.5 pl-2">
                    <span className={cn("rounded-full border px-1.5 py-0.5 text-[10px]", tag.cls)}>{tag.label}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

// ── 12. entry trigger ─────────────────────────────────────────────────────

/**
 * The one panel that answers "为什么在那一刻进场". Everything else on this page
 * comes from order metadata; this comes from joining each fill to XAUUSD 1m
 * bars and comparing against random minutes in the same sessions.
 */
export function EntryPanel({ entry }: { entry: EntryAnalysis | null }) {
  if (!entry) {
    return (
      <Panel title="入场触发反推" hint="需要 K 线对齐">
        <p className="text-xs text-zinc-500">
          还没有 <code>data/entry-analysis.json</code>。在家服跑{" "}
          <code>/data/llm-macro-alpha-research/.venv/bin/python
          /data/trademax-observer/scripts/entry_reverse.py</code> 生成。
        </p>
      </Panel>
    )
  }
  const strong = entry.features.filter((f) => Math.abs(f.z) >= 2)
  const flat = entry.features.filter((f) => Math.abs(f.z) < 2)
  const maxZ = Math.max(3, ...entry.features.map((f) => Math.abs(f.z)))

  return (
    <Panel title="入场触发反推（把每笔成交对齐到 XAUUSD 1 分钟线）"
           hint={`${entry.aligned}/${entry.decisions} 个决策对齐成功，与 ${entry.baselineSamples} 个「同日同时段随机分钟」对照；|z|≥2 才算有信号`}>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {entry.trendAgreement.map((t) => (
          <Tile key={t.window} label={`与前 ${t.window} 分钟同向`}
                value={`${(t.share * 100).toFixed(0)}%`}
                tone={t.share > 0.8 ? "good" : "neutral"}
                sub={t.share > 0.8 ? "强顺势" : undefined} />
        ))}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <Tile label="距前 30 分钟同向极值"
              value={entry.pullback.distExt30Median != null ? `$${entry.pullback.distExt30Median.toFixed(2)}` : "—"}
              sub={entry.pullback.distInAtr != null ? `≈ ${entry.pullback.distInAtr.toFixed(2)} 个 ATR，正数=还没摸到极值` : undefined} />
        <Tile label="已突破极值才进的" value={`${entry.pullback.alreadyBroken} / ${entry.pullback.n}`}
              tone="warn" sub="所以不是「追破新高新低」" />
        <Tile label="入场秒落在每分钟前 5 秒"
              value={`${entry.clock.secondsInFirst5} / ${entry.clock.n}`}
              sub="没有 K 线周期指纹 → 逐 tick 连续判断" />
      </div>

      <div className="mt-4">
        <div className="mb-2 text-xs text-zinc-300">候选触发条件 vs 随机分钟（横条 = |z|）</div>
        <div className="space-y-1.5">
          {[...strong, ...flat].map((f) => {
            const w = (Math.abs(f.z) / maxZ) * 100
            const hot = Math.abs(f.z) >= 2
            return (
              <div key={f.key} className="flex items-center gap-2 text-[11px]">
                <span className="w-36 shrink-0 text-zinc-400">{f.label}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800/60">
                  <div className={cn("h-full rounded-full", hot ? "bg-emerald-500/70" : "bg-zinc-600/60")}
                       style={{ width: `${w}%` }} />
                </div>
                <span className={cn("w-28 shrink-0 text-right tabular-nums", hot ? "text-emerald-400" : "text-zinc-600")}>
                  {f.real.toFixed(2)} vs {f.base.toFixed(2)}
                </span>
                <span className={cn("w-16 shrink-0 text-right tabular-nums", hot ? "text-emerald-300" : "text-zinc-600")}>
                  z={f.z.toFixed(1)}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="mt-4 grid gap-2 lg:grid-cols-2">
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2 text-[11px] leading-5 text-zinc-300">
          <span className="font-semibold text-emerald-300">结论：</span>
          顺势的「推动之后回抽一点」再进场。前 30 分钟已经走出一波，价格停在这波的高位但<span className="text-emerald-200">还没</span>创新极值
          （中位差 {entry.pullback.distExt30Median?.toFixed(2) ?? "—"} 美元），
          价格在均线上方、方向化 RSI 偏高，此时开仓。
        </div>
        <div className="rounded-lg border border-zinc-700/60 bg-zinc-950/40 px-3 py-2 text-[11px] leading-5 text-zinc-400">
          <span className="font-semibold text-zinc-300">这些它不看：</span>
          {flat.map((f) => f.label).join(" / ") || "—"} —— 全部与随机分钟无差异，
          说明没有波动率闸、没有整数关口逻辑、也不按固定周期轮询。
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-5 text-zinc-500">
        <span className="text-amber-300">口径提醒：</span>
        动量类特征彼此高度相关，能确定的是<span className="text-zinc-300">「趋势延续」这一族</span>，
        不能断言具体用的是哪根均线/哪个指标。而且单靠这个方向闸不够选择性
        （放宽到覆盖 90% 实际入场时，市场绝大多数时间都满足），实际节流主要来自
        「一次一单」+ 决策间隔中位 {entry.gaps.medianMin?.toFixed(0) ?? "—"} 分钟 —— 还有一层触发逻辑没看到。
        生成于 {entry.generatedAt.slice(0, 16).replace("T", " ")} UTC。
      </p>
    </Panel>
  )
}
