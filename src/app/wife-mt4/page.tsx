"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowLeft, RefreshCw } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type Position = {
  ticket: number
  symbol: string
  type: string
  lots: number
  open_price: number
  open_time: string
  sl: number
  tp: number
  current_price: number | null
  floating_pnl: number
  comment: string | null
  hypothesis_id: number | null
  hypothesis_reason_category: string | null
  hypothesis_free_text: string | null
  hypothesis_llm_confidence: number | null
  hypothesis_verified_status: string | null
  hypothesis_raised_question: string | null
  hypothesis_created_at: string | null
}

type Hypothesis = {
  id: number
  ticket: number
  source: string
  reason_category: string | null
  free_text: string | null
  llm_confidence: number | null
  verified_status: string
  raised_question: string | null
  created_at: string
}

type ClosedTrade = {
  ticket: number
  symbol: string
  type: string
  lots: number
  open_price: number
  open_time: string
  close_price: number | null
  close_time: string | null
  profit: number
  swap: number
  commission: number
}

type Account = {
  balance: number
  equity: number
  margin_level: number | null
  snapshot_at: string
} | null

const VERIFY_OPTIONS: Array<{ value: "agreed" | "corrected" | "unknown" | "pending_wife"; label: string; tone: "ok" | "warn" | "muted" | "info" }> = [
  { value: "agreed", label: "认同 LLM", tone: "ok" },
  { value: "corrected", label: "我来补充", tone: "warn" },
  { value: "unknown", label: "我也不知道", tone: "muted" },
  { value: "pending_wife", label: "我去问老婆", tone: "info" },
]

function fmtUtc(value: string | null | undefined): string {
  if (!value) return "—"
  const d = new Date(value)
  if (isNaN(d.getTime())) return value
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z").replace(/:\d{2}Z$/, "Z")
}

function fmtBeijing(value: string | null | undefined): string {
  if (!value) return "—"
  const d = new Date(value)
  if (isNaN(d.getTime())) return value
  const local = new Date(d.getTime() + 8 * 3600_000)
  return local.toISOString().replace("T", " ").replace(/\.\d+Z$/, " 北京")
}

function pnlClass(n: number): string {
  if (n > 0) return "text-emerald-400"
  if (n < 0) return "text-rose-400"
  return "text-zinc-400"
}

function confidenceBadge(c: number | null | undefined) {
  if (c == null) return <Badge variant="secondary">conf —</Badge>
  if (c >= 0.7) return <Badge className="bg-emerald-500/20 text-emerald-300">conf {c.toFixed(2)}</Badge>
  if (c >= 0.5) return <Badge className="bg-amber-500/20 text-amber-300">conf {c.toFixed(2)}</Badge>
  return <Badge className="bg-rose-500/20 text-rose-300">conf {c.toFixed(2)}</Badge>
}

function statusBadge(s: string | null | undefined) {
  switch (s) {
    case "agreed":
      return <Badge className="bg-emerald-500/20 text-emerald-300">已认同</Badge>
    case "corrected":
      return <Badge className="bg-amber-500/20 text-amber-300">已补充</Badge>
    case "unknown":
      return <Badge className="bg-zinc-500/20 text-zinc-300">不知道</Badge>
    case "pending_wife":
      return <Badge className="bg-sky-500/20 text-sky-300">问老婆中</Badge>
    default:
      return <Badge className="bg-foreground/10 text-foreground/70">未审</Badge>
  }
}

type ProfileLatest = {
  id: number
  generated_at: string
  sample_size: number
  blind_test_score: number | null
  blind_test_n: number | null
  profile: {
    profile?: {
      descriptive?: Record<string, unknown>
      layer2?: Record<string, unknown>
      layer3?: Record<string, unknown>
      regime_filter?: string | null
    }
    blind_test?: {
      n_holdout?: number
      rule_score?: number
      llm_score?: number | null
      majority_baseline?: number | null
    }
  }
}

type ProfileHistoryRow = {
  id: number
  generated_at: string
  sample_size: number
  blind_test_score: number | null
  blind_test_n: number | null
}

type Tab = "review" | "profile"

export default function WifeMT4Page() {
  const [tab, setTab] = useState<Tab>("review")
  const [positions, setPositions] = useState<Position[]>([])
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([])
  const [closed, setClosed] = useState<ClosedTrade[]>([])
  const [account, setAccount] = useState<Account>(null)
  const [healthz, setHealthz] = useState<{ db?: string; dwx_age_sec?: number | null } | null>(null)
  const [profile, setProfile] = useState<ProfileLatest | null>(null)
  const [profileHistory, setProfileHistory] = useState<ProfileHistoryRow[]>([])
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)

  const fetchAll = useCallback(async () => {
    setError(null)
    try {
      const [posRes, hypRes, hisRes, accRes, healthRes, profRes, profHistRes] = await Promise.all([
        fetch("/api/wife-mt4/positions", { cache: "no-store" }),
        fetch("/api/wife-mt4/hypotheses?status=all", { cache: "no-store" }),
        fetch("/api/wife-mt4/history?days=7", { cache: "no-store" }),
        fetch("/api/wife-mt4/account", { cache: "no-store" }),
        fetch("/api/wife-mt4/healthz", { cache: "no-store" }),
        fetch("/api/wife-mt4/profile/latest", { cache: "no-store" }),
        fetch("/api/wife-mt4/profile/history", { cache: "no-store" }),
      ])
      if (!posRes.ok || !hypRes.ok || !hisRes.ok) {
        throw new Error(`upstream HTTP ${posRes.status}/${hypRes.status}/${hisRes.status}`)
      }
      setPositions(await posRes.json())
      setHypotheses(await hypRes.json())
      setClosed(await hisRes.json())
      setAccount(accRes.ok ? await accRes.json() : null)
      setHealthz(healthRes.ok ? await healthRes.json() : null)
      if (profRes.ok) {
        const p = await profRes.json()
        setProfile(p)
      } else {
        setProfile(null)
      }
      if (profHistRes.ok) {
        setProfileHistory(await profHistRes.json())
      }
      setLastRefreshed(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
    const t = setInterval(fetchAll, 30_000)
    return () => clearInterval(t)
  }, [fetchAll])

  const verify = useCallback(
    async (id: number, status: "agreed" | "corrected" | "unknown" | "pending_wife") => {
      setBusyId(id)
      try {
        const res = await fetch(`/api/wife-mt4/hypotheses/${id}/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status, verified_by: "taieo" }),
        })
        if (!res.ok) throw new Error(`verify failed: ${res.status} ${await res.text()}`)
        await fetchAll()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusyId(null)
      }
    },
    [fetchAll]
  )

  const raisedQueue = useMemo(() => {
    return hypotheses.filter(
      (h) =>
        h.source === "llm" &&
        h.raised_question &&
        (h.llm_confidence ?? 0) < 0.5 &&
        h.verified_status === "unverified"
    )
  }, [hypotheses])

  const reviewQueue = useMemo(() => {
    const raisedIds = new Set(raisedQueue.map((h) => h.id))
    return hypotheses.filter(
      (h) => h.source === "llm" && h.verified_status === "unverified" && !raisedIds.has(h.id)
    )
  }, [hypotheses, raisedQueue])

  const closedByTicket = useMemo(() => {
    const m = new Map<number, ClosedTrade>()
    for (const c of closed) m.set(c.ticket, c)
    return m
  }, [closed])

  const hypothesisByTicket = useMemo(() => {
    const m = new Map<number, Hypothesis>()
    for (const h of hypotheses) {
      if (h.source !== "llm") continue
      const prev = m.get(h.ticket)
      if (!prev || new Date(h.created_at) > new Date(prev.created_at)) {
        m.set(h.ticket, h)
      }
    }
    return m
  }, [hypotheses])

  return (
    <main className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-zinc-400 hover:text-foreground">
            <ArrowLeft className="size-5" />
          </Link>
          <div>
            <h1 className="text-xl font-heading font-semibold">老婆 MT4 实盘观察</h1>
            <p className="text-xs text-muted-foreground">
              account 2179205 · ECMarkets-Live02 · LLM 自动归因 + 审稿式 verify
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            db <span className={healthz?.db === "ok" ? "text-emerald-400" : "text-rose-400"}>{healthz?.db ?? "?"}</span>
          </span>
          <span>
            dwx <span className={(healthz?.dwx_age_sec ?? 999) < 60 ? "text-emerald-400" : "text-amber-400"}>{healthz?.dwx_age_sec ?? "?"}s</span>
          </span>
          {lastRefreshed && <span>refreshed {fmtBeijing(lastRefreshed.toISOString())}</span>}
          <Button size="sm" variant="ghost" onClick={fetchAll} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin size-4" : "size-4"} />
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-rose-500/40 bg-rose-500/10">
          <CardContent>
            <p className="text-sm text-rose-300">⚠ {error}</p>
          </CardContent>
        </Card>
      )}

      {/* ── tab 切换 ── */}
      <div className="flex gap-2 border-b border-foreground/10">
        <button
          onClick={() => setTab("review")}
          className={`px-4 py-2 text-sm border-b-2 -mb-px transition ${
            tab === "review" ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          实时审稿
        </button>
        <button
          onClick={() => setTab("profile")}
          className={`px-4 py-2 text-sm border-b-2 -mb-px transition ${
            tab === "profile" ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          操盘画像 {profile && <span className="text-xs text-muted-foreground">({profileHistory.length})</span>}
        </button>
      </div>

      {tab === "profile" && <ProfileView profile={profile} history={profileHistory} />}

      {tab === "review" && (<>

      {/* ── 账户快照 ── */}
      {account && (
        <Card size="sm">
          <CardContent className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <span>
              balance <strong>${account.balance?.toFixed(2)}</strong>
            </span>
            <span>
              equity <strong>${account.equity?.toFixed(2)}</strong>
            </span>
            {account.margin_level !== null && account.margin_level !== undefined && (
              <span>margin level {account.margin_level.toFixed(0)}%</span>
            )}
            <span className="text-muted-foreground text-xs">snapshot {fmtBeijing(account.snapshot_at)}</span>
          </CardContent>
        </Card>
      )}

      {/* ── 🔴 主动问询队列 ── */}
      {raisedQueue.length > 0 && (
        <Card className="border-rose-500/40 bg-rose-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-rose-300">
              🔴 主动问询队列 <Badge className="bg-rose-500/30 text-rose-100">{raisedQueue.length}</Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              LLM 自评 conf &lt; 0.5 且想问交易者具体问题。可一键认同最高假设、补充、跳过、或挂"问老婆中"。
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {raisedQueue.map((h) => (
              <RaisedCard
                key={h.id}
                h={h}
                busy={busyId === h.id}
                onVerify={(status) => verify(h.id, status)}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── 当前持仓 ── */}
      <Card>
        <CardHeader>
          <CardTitle>当前持仓 ({positions.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {positions.length === 0 && <p className="text-sm text-muted-foreground">暂无持仓。</p>}
          {positions.map((p) => (
            <PositionCard
              key={p.ticket}
              p={p}
              hypothesis={hypothesisByTicket.get(p.ticket) ?? null}
              busy={busyId === p.hypothesis_id}
              onVerify={(status) =>
                p.hypothesis_id != null ? verify(p.hypothesis_id, status) : undefined
              }
            />
          ))}
        </CardContent>
      </Card>

      {/* ── 审稿区(conf ≥ 0.5 的 unverified) ── */}
      {reviewQueue.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>审稿区 ({reviewQueue.length})</CardTitle>
            <p className="text-xs text-muted-foreground">
              LLM conf ≥ 0.5,默认值得审。空忙时一键扫一下。
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {reviewQueue.map((h) => (
              <ReviewCard
                key={h.id}
                h={h}
                busy={busyId === h.id}
                onVerify={(status) => verify(h.id, status)}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── 最近 7 天已平仓 + LLM hypothesis + outcome 对照 ── */}
      <Card>
        <CardHeader>
          <CardTitle>最近 7 天已平仓 ({closed.length})</CardTitle>
          <p className="text-xs text-muted-foreground">
            outcome ↔ LLM hypothesis 三列对照,看归因是否站得住脚。
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto -mx-4 sm:-mx-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-muted-foreground border-b border-foreground/10">
                <tr>
                  <th className="px-2 py-2 text-left font-medium">ticket</th>
                  <th className="px-2 py-2 text-left font-medium">symbol</th>
                  <th className="px-2 py-2 text-left font-medium">type</th>
                  <th className="px-2 py-2 text-right font-medium">lots</th>
                  <th className="px-2 py-2 text-left font-medium">open / close (UTC)</th>
                  <th className="px-2 py-2 text-right font-medium">net pnl</th>
                  <th className="px-2 py-2 text-left font-medium">LLM hypothesis</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((c) => {
                  const h = hypothesisByTicket.get(c.ticket)
                  const net = c.profit + (c.swap ?? 0) + (c.commission ?? 0)
                  return (
                    <tr key={c.ticket} className="border-b border-foreground/5">
                      <td className="px-2 py-2 font-mono text-xs">{c.ticket}</td>
                      <td className="px-2 py-2">{c.symbol}</td>
                      <td className="px-2 py-2">{c.type}</td>
                      <td className="px-2 py-2 text-right">{c.lots}</td>
                      <td className="px-2 py-2 text-xs text-muted-foreground">
                        {fmtUtc(c.open_time)}
                        <br />
                        {fmtUtc(c.close_time)}
                      </td>
                      <td className={`px-2 py-2 text-right font-mono ${pnlClass(net)}`}>
                        {net.toFixed(2)}
                      </td>
                      <td className="px-2 py-2 text-xs">
                        {h ? (
                          <span>
                            <span className="font-medium">{h.reason_category ?? "?"}</span>{" "}
                            {confidenceBadge(h.llm_confidence)} {statusBadge(h.verified_status)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">无归因(早于 LLM 上线)</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      </>)}
    </main>
  )

  // helper local components below — keep them inline so the page is self-contained
}

function ProfileView({
  profile,
  history,
}: {
  profile: ProfileLatest | null
  history: ProfileHistoryRow[]
}) {
  if (!profile) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-muted-foreground">还没有画像数据。运行 <code>profile_agent</code> 后会出现。</p>
        </CardContent>
      </Card>
    )
  }
  const inner = profile.profile?.profile ?? {}
  const blind = profile.profile?.blind_test ?? {}
  const desc = (inner as { descriptive?: Record<string, unknown> })?.descriptive ?? {}
  const layer2 = (inner as { layer2?: Record<string, unknown> })?.layer2 ?? {}
  const layer3 = (inner as { layer3?: Record<string, unknown> })?.layer3 ?? {}
  const regime = (inner as { regime_filter?: string | null })?.regime_filter
  const score = profile.blind_test_score
  const scoreColor =
    score == null
      ? "text-muted-foreground"
      : score < 0.5
        ? "text-rose-400"
        : score < 0.55
          ? "text-amber-400"
          : score <= 0.65
            ? "text-emerald-400"
            : score <= 0.8
              ? "text-amber-400"
              : "text-rose-400"

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-baseline gap-3">
            <span>操盘画像</span>
            <span className="text-xs text-muted-foreground">
              id #{profile.id} · {fmtBeijing(profile.generated_at)} · n={profile.sample_size}{regime ? ` · regime=${regime}` : ""}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <span className="text-sm">
              盲测命中率 <span className={`text-lg font-semibold ${scoreColor}`}>{score != null ? `${(score * 100).toFixed(1)}%` : "—"}</span>
              <span className="text-xs text-muted-foreground"> (n={profile.blind_test_n ?? "?"})</span>
            </span>
            {blind.majority_baseline != null && (
              <span className="text-xs text-muted-foreground">
                majority baseline {(blind.majority_baseline * 100).toFixed(1)}%
              </span>
            )}
            {blind.rule_score != null && (
              <span className="text-xs">
                rule {(blind.rule_score * 100).toFixed(1)}%
              </span>
            )}
            {blind.llm_score != null && (
              <span className="text-xs">
                llm {(blind.llm_score * 100).toFixed(1)}%
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            55-65% 健康(有真 alpha) · 50-55 / 65-80 临界 · &lt;50% 反相关 · &gt;80% 怀疑信息泄露
          </p>
        </CardContent>
      </Card>

      <ProfileLayer1 desc={desc} />
      <ProfileLayer2 layer2={layer2} />
      <ProfileLayer3 layer3={layer3} />
      <ProfileHistoryTable history={history} />
    </div>
  )
}

function ProfileLayer1({ desc }: { desc: Record<string, unknown> }) {
  const bySymbol = (desc.by_symbol as Record<string, Record<string, number>>) ?? {}
  const bySession = (desc.by_session as Record<string, Record<string, number>>) ?? {}
  const concur = (desc.concurrent_positions as { mean?: number; p50?: number; p90?: number; max?: number }) ?? {}
  const byBucket = (desc.by_concurrency_bucket as Record<string, Record<string, number>>) ?? {}
  const streaks = (desc.streaks as Record<string, number>) ?? {}
  const afterLoss = (desc.behaviour_after_loss as Record<string, number | null>) ?? {}
  return (
    <Card>
      <CardHeader>
        <CardTitle>Layer 1 — 描述统计</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <span>n {String(desc.n_trades ?? "?")}</span>
          <span>win {desc.win_rate != null ? `${((desc.win_rate as number) * 100).toFixed(1)}%` : "?"}</span>
          <span>net ${desc.net_total != null ? (desc.net_total as number).toFixed(2) : "?"}</span>
          <span>expectancy ${desc.expectancy_per_trade != null ? (desc.expectancy_per_trade as number).toFixed(2) : "?"}/trade</span>
        </div>

        {Object.keys(bySymbol).length > 0 && (
          <div>
            <h4 className="font-medium mb-1">品种</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground"><tr>
                  <th className="text-left p-1">symbol</th><th className="p-1">n</th>
                  <th className="text-right p-1">net</th><th className="text-right p-1">avg</th>
                  <th className="text-right p-1">win</th><th className="text-right p-1">hold(min)</th>
                  <th className="text-right p-1">lots</th>
                </tr></thead>
                <tbody>
                  {Object.entries(bySymbol).map(([sym, s]) => (
                    <tr key={sym} className="border-t border-foreground/5">
                      <td className="p-1">{sym}</td><td className="p-1 text-right">{s.count}</td>
                      <td className={`p-1 text-right ${(s.net_pnl ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{(s.net_pnl ?? 0).toFixed(2)}</td>
                      <td className="p-1 text-right">{(s.avg_pnl ?? 0).toFixed(2)}</td>
                      <td className="p-1 text-right">{((s.win_rate ?? 0) * 100).toFixed(1)}%</td>
                      <td className="p-1 text-right">{(s.avg_hold_min ?? 0).toFixed(0)}</td>
                      <td className="p-1 text-right">{(s.avg_lots ?? 0).toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {Object.keys(bySession).length > 0 && (
          <div>
            <h4 className="font-medium mb-1">时段(broker = NY+7h)</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground"><tr>
                  <th className="text-left p-1">session</th><th className="p-1">n</th>
                  <th className="text-right p-1">net</th><th className="text-right p-1">win</th>
                </tr></thead>
                <tbody>
                  {Object.entries(bySession).map(([sess, s]) => (
                    <tr key={sess} className="border-t border-foreground/5">
                      <td className="p-1">{sess}</td><td className="p-1 text-right">{s.count}</td>
                      <td className={`p-1 text-right ${(s.net_pnl ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{(s.net_pnl ?? 0).toFixed(2)}</td>
                      <td className="p-1 text-right">{((s.win_rate ?? 0) * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {concur && Object.keys(concur).length > 0 && (
          <div>
            <h4 className="font-medium mb-1">并发持仓</h4>
            <p className="text-xs text-muted-foreground mb-1">
              mean {concur.mean?.toFixed(2) ?? "?"} · p50/p90/max {concur.p50}/{concur.p90}/{concur.max}
            </p>
            {Object.keys(byBucket).length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground"><tr>
                    <th className="text-left p-1">bucket</th><th className="p-1">n</th>
                    <th className="text-right p-1">win</th><th className="text-right p-1">avg pnl</th>
                  </tr></thead>
                  <tbody>
                    {Object.entries(byBucket).map(([b, s]) => (
                      <tr key={b} className="border-t border-foreground/5">
                        <td className="p-1">{b}</td><td className="p-1 text-right">{s.count}</td>
                        <td className="p-1 text-right">{((s.win_rate ?? 0) * 100).toFixed(1)}%</td>
                        <td className={`p-1 text-right ${(s.avg_pnl ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{(s.avg_pnl ?? 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {Object.keys(streaks).length > 0 && (
          <div>
            <h4 className="font-medium mb-1">连胜连败</h4>
            <p className="text-xs text-muted-foreground">
              max win streak {streaks.max_win_streak} · max loss {streaks.max_loss_streak} · mean win {streaks.mean_win_streak?.toFixed(2)} / loss {streaks.mean_loss_streak?.toFixed(2)}
            </p>
          </div>
        )}

        {afterLoss && (afterLoss.n ?? 0) > 0 && (
          <div>
            <h4 className="font-medium mb-1">亏损后行为</h4>
            <p className="text-xs text-muted-foreground">
              n={afterLoss.n} · 中位距上次平仓 {afterLoss.median_min_since_prev_loss?.toFixed(0) ?? "?"}min · 反向开仓 {afterLoss.direction_flip_pct != null ? `${(afterLoss.direction_flip_pct * 100).toFixed(1)}%` : "?"} · 后续胜率 {afterLoss.win_rate_after_loss != null ? `${(afterLoss.win_rate_after_loss * 100).toFixed(1)}%` : "?"}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ProfileLayer2({ layer2 }: { layer2: Record<string, unknown> }) {
  const sigs = (layer2.behavioural_signatures as Array<Record<string, unknown>>) ?? []
  const anoms = (layer2.anomalies as Array<Record<string, unknown>>) ?? []
  const narrative = layer2.narrative as string | undefined
  if (!sigs.length && !anoms.length && !narrative) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Layer 2 — 行为特征(LLM)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {sigs.length > 0 && (
          <div className="space-y-2">
            {sigs.map((s, i) => (
              <div key={i} className="rounded-md border border-foreground/10 p-2 text-xs">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium">{String(s.name ?? "?")}</span>
                  <Badge variant="secondary" className="text-xs">{String(s.magnitude ?? "?")}</Badge>
                </div>
                <p className="text-foreground/80 mt-1">{String(s.description ?? "")}</p>
                {Array.isArray(s.evidence_metric_keys) && s.evidence_metric_keys.length > 0 && (
                  <p className="text-muted-foreground mt-1">
                    evidence: <code>{(s.evidence_metric_keys as string[]).join(", ")}</code>
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
        {anoms.length > 0 && (
          <div>
            <h4 className="font-medium mb-1">反常 / 矛盾</h4>
            <ul className="list-disc list-inside text-xs space-y-1">
              {anoms.map((a, i) => (
                <li key={i} className="text-foreground/80">
                  <span>{String(a.observation ?? "")}</span> — <span className="text-muted-foreground">{String(a.why_unusual ?? "")}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {narrative && (
          <div>
            <h4 className="font-medium mb-1">总结</h4>
            <p className="text-xs text-foreground/80">{narrative}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ProfileLayer3({ layer3 }: { layer3: Record<string, unknown> }) {
  const hyps = (layer3.alpha_hypotheses as Array<Record<string, unknown>>) ?? []
  const edge = layer3.edge_summary as string | undefined
  if (!hyps.length && !edge) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Layer 3 — alpha 假说(LLM)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {hyps.map((h, i) => (
          <div key={i} className="rounded-md border border-foreground/10 p-2 text-xs space-y-1">
            <div className="flex items-baseline gap-2">
              <Badge variant="secondary">{String(h.id ?? `h${i + 1}`)}</Badge>
              <span className="font-medium">{String(h.statement ?? "")}</span>
            </div>
            <p><span className="text-muted-foreground">可证伪 prediction:</span> {String(h.falsifiable_prediction ?? "")}</p>
            <p><span className="text-muted-foreground">expected metric:</span> {String(h.expected_metric ?? "")}</p>
            <p><span className="text-muted-foreground">holdout threshold:</span> {String(h.holdout_threshold ?? "?")}</p>
            <p className="text-foreground/70">{String(h.rationale ?? "")}</p>
          </div>
        ))}
        {edge && (
          <div className="border-t border-foreground/10 pt-2">
            <h4 className="font-medium mb-1">Edge 概括</h4>
            <p className="text-xs">{edge}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ProfileHistoryTable({ history }: { history: ProfileHistoryRow[] }) {
  if (!history.length) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>历次画像 ({history.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground border-b border-foreground/10"><tr>
              <th className="text-left p-1">id</th>
              <th className="text-left p-1">generated</th>
              <th className="text-right p-1">sample</th>
              <th className="text-right p-1">blind n</th>
              <th className="text-right p-1">blind score</th>
            </tr></thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id} className="border-b border-foreground/5">
                  <td className="p-1 font-mono">#{r.id}</td>
                  <td className="p-1">{fmtBeijing(r.generated_at)}</td>
                  <td className="p-1 text-right">{r.sample_size}</td>
                  <td className="p-1 text-right">{r.blind_test_n ?? "?"}</td>
                  <td className={`p-1 text-right font-mono ${
                    r.blind_test_score == null ? "text-muted-foreground" :
                    r.blind_test_score < 0.5 ? "text-rose-400" :
                    r.blind_test_score < 0.55 ? "text-amber-400" :
                    r.blind_test_score <= 0.65 ? "text-emerald-400" :
                    r.blind_test_score <= 0.8 ? "text-amber-400" : "text-rose-400"
                  }`}>
                    {r.blind_test_score != null ? `${(r.blind_test_score * 100).toFixed(1)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function VerifyButtons({
  busy,
  onVerify,
}: {
  busy: boolean
  onVerify: (status: "agreed" | "corrected" | "unknown" | "pending_wife") => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {VERIFY_OPTIONS.map((opt) => (
        <Button
          key={opt.value}
          size="sm"
          variant={opt.tone === "ok" ? "default" : "outline"}
          disabled={busy}
          onClick={() => onVerify(opt.value)}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  )
}

function HypothesisBody({ h }: { h: Pick<Hypothesis, "reason_category" | "free_text" | "llm_confidence" | "raised_question" | "created_at"> }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium">{h.reason_category ?? "?"}</span>
        {confidenceBadge(h.llm_confidence)}
        <span className="text-xs text-muted-foreground">written {fmtBeijing(h.created_at)}</span>
      </div>
      {h.free_text && (
        <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-foreground/80">
          {h.free_text}
        </pre>
      )}
      {h.raised_question && (
        <div className="rounded-md bg-rose-500/10 border border-rose-500/30 p-2 text-xs">
          <span className="font-medium text-rose-200">LLM 想问:</span>{" "}
          <span className="text-foreground/90">{h.raised_question}</span>
        </div>
      )}
    </div>
  )
}

function RaisedCard({
  h,
  busy,
  onVerify,
}: {
  h: Hypothesis
  busy: boolean
  onVerify: (status: "agreed" | "corrected" | "unknown" | "pending_wife") => void
}) {
  return (
    <div className="rounded-lg border border-rose-500/30 bg-card/50 p-3 space-y-3">
      <div className="text-xs text-muted-foreground">ticket {h.ticket}</div>
      <HypothesisBody h={h} />
      <VerifyButtons busy={busy} onVerify={onVerify} />
    </div>
  )
}

function ReviewCard({
  h,
  busy,
  onVerify,
}: {
  h: Hypothesis
  busy: boolean
  onVerify: (status: "agreed" | "corrected" | "unknown" | "pending_wife") => void
}) {
  return (
    <div className="rounded-lg border border-foreground/10 bg-card/40 p-3 space-y-3">
      <div className="text-xs text-muted-foreground">ticket {h.ticket}</div>
      <HypothesisBody h={h} />
      <VerifyButtons busy={busy} onVerify={onVerify} />
    </div>
  )
}

function PositionCard({
  p,
  hypothesis,
  busy,
  onVerify,
}: {
  p: Position
  hypothesis: Hypothesis | null
  busy: boolean
  onVerify: (status: "agreed" | "corrected" | "unknown" | "pending_wife") => void
}) {
  const h = hypothesis
  return (
    <div className="rounded-lg border border-foreground/10 bg-card/40 p-3 space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-mono text-xs text-muted-foreground">#{p.ticket}</span>
        <span className="font-medium">
          {p.symbol} <span className={p.type === "buy" ? "text-emerald-400" : "text-rose-400"}>{p.type}</span> {p.lots}
        </span>
        <span className="text-xs text-muted-foreground">
          @ {p.open_price} ({fmtUtc(p.open_time)})
        </span>
        <span className={`font-mono ${pnlClass(p.floating_pnl ?? 0)}`}>
          浮动 {p.floating_pnl?.toFixed(2)}
        </span>
        {(p.sl > 0 || p.tp > 0) && (
          <span className="text-xs text-muted-foreground">
            SL {p.sl || "—"} / TP {p.tp || "—"}
          </span>
        )}
        {p.comment && (
          <span className="text-xs text-muted-foreground truncate max-w-[18rem]" title={p.comment}>
            {p.comment}
          </span>
        )}
      </div>
      {h ? (
        <>
          <div className="border-t border-foreground/5 pt-3">
            <HypothesisBody h={h} />
          </div>
          {h.verified_status === "unverified" ? (
            <VerifyButtons busy={busy} onVerify={onVerify} />
          ) : (
            <div className="text-xs">{statusBadge(h.verified_status)}</div>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">⏳ LLM 还没归因(预计 1 分钟内)。</p>
      )}
    </div>
  )
}
