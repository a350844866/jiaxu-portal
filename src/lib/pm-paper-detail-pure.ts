/**
 * pm-paper detail dashboard — pure join/derivation logic (no node:fs), so it
 * can be unit-tested with plain fixtures and safely imported client-side.
 *
 * `replayOpenOrders` is a direct TS port of /data/pm-paper/executor.py's
 * `replay_open_orders`: refresh implicitly replaces any prior open order on
 * the same market; cancel/fill/expire close it. Keep these two in lockstep —
 * if executor.py's semantics change, mirror the change here.
 */

export type OrderEventType = "open" | "refresh" | "cancel" | "fill" | "expire"

export interface OrderEvent {
  order_id: string
  market_id: string
  side?: "YES" | "NO"
  limit?: number
  shares?: number
  usd?: number
  prediction_ts?: number
  mid_at_order?: number
  event: OrderEventType
  ts: number
  replaces?: string
  reason?: string
}

export interface Prediction {
  ts: number
  market_id: string
  p: number
  confidence: "low" | "medium" | "high"
  reasoning: string
  rules_notes: string
  mid_at_prediction: number
  trigger?: string
}

export interface Fill {
  order_id: string
  market_id: string
  fill_ts: number
  fill_price: number
  side: "YES" | "NO"
  shares: number
}

export interface Settlement {
  market_id: string
  outcome: number
  resolve_ts: number
  filled: boolean
  had_order?: boolean
  cost: number
  pnl: number
  p: number
  brier_claude: number
  brier_market: number
  cohort?: string
  question?: string
}

export interface UniverseMarket {
  id: string
  slug?: string
  question: string
  event_slug?: string
  end_date?: string
  cohort: string
  tick?: number
  liq?: number
  rule_flag?: "ok" | "rule_edge" | "rule_trap" | "unreviewed"
  rule_note?: string
}

/** Port of executor.py replay_open_orders: -> {market_id: latest open order}. */
export function replayOpenOrders(events: OrderEvent[]): Map<string, OrderEvent> {
  const byMarket = new Map<string, OrderEvent>()
  for (const e of events) {
    const m = e.market_id
    if (e.event === "open" || e.event === "refresh") {
      byMarket.set(m, e)
    } else if (e.event === "cancel" || e.event === "fill" || e.event === "expire") {
      byMarket.delete(m)
    }
  }
  return byMarket
}

/** Port of executor.py latest_predictions: -> {market_id: latest-by-ts prediction}. */
export function latestPredictionsByMarket(preds: Prediction[]): Map<string, Prediction> {
  const latest = new Map<string, Prediction>()
  for (const p of preds) {
    const m = String(p.market_id)
    const cur = latest.get(m)
    if (!cur || p.ts > cur.ts) latest.set(m, p)
  }
  return latest
}

/** Filled positions not yet settled (mirrors executor.py markets_with_open_positions,
 * but keeps the full Fill row for display instead of just the market_id set). */
export function openPositions(fills: Fill[], settlements: Settlement[]): Fill[] {
  const settled = new Set(settlements.map((s) => s.market_id))
  return fills.filter((f) => !settled.has(f.market_id))
}

function universeQuestion(universe: Map<string, UniverseMarket>, marketId: string): string {
  return universe.get(marketId)?.question ?? `(市场 ${marketId})`
}

export interface OpenOrderRow {
  order_id: string
  market_id: string
  question: string
  cohort: string | null
  rule_flag: string | null
  side: string
  limit: number
  shares: number
  usd: number
  ts: number
  mid_at_order: number
}

export function buildOpenOrderRows(
  orders: OrderEvent[],
  universe: Map<string, UniverseMarket>,
): OpenOrderRow[] {
  const open = replayOpenOrders(orders)
  return Array.from(open.values())
    .map((o) => ({
      order_id: o.order_id,
      market_id: o.market_id,
      question: universeQuestion(universe, o.market_id),
      cohort: universe.get(o.market_id)?.cohort ?? null,
      rule_flag: universe.get(o.market_id)?.rule_flag ?? null,
      side: o.side ?? "",
      limit: o.limit ?? 0,
      shares: o.shares ?? 0,
      usd: o.usd ?? 0,
      ts: o.ts,
      mid_at_order: o.mid_at_order ?? 0,
    }))
    .sort((a, b) => b.ts - a.ts)
}

export interface PositionRow {
  order_id: string
  market_id: string
  question: string
  cohort: string | null
  side: string
  fill_price: number
  shares: number
  fill_ts: number
  cost: number
}

export function buildPositionRows(
  fills: Fill[],
  settlements: Settlement[],
  universe: Map<string, UniverseMarket>,
): PositionRow[] {
  return openPositions(fills, settlements)
    .map((f) => ({
      order_id: f.order_id,
      market_id: f.market_id,
      question: universeQuestion(universe, f.market_id),
      cohort: universe.get(f.market_id)?.cohort ?? null,
      side: f.side,
      fill_price: f.fill_price,
      shares: f.shares,
      fill_ts: f.fill_ts,
      cost: Math.round(f.fill_price * f.shares * 100) / 100,
    }))
    .sort((a, b) => b.fill_ts - a.fill_ts)
}

export interface PredictionRow {
  market_id: string
  question: string
  cohort: string | null
  rule_flag: string | null
  rule_note: string | null
  p: number
  mid_at_prediction: number
  divergence: number
  confidence: string
  trigger: string | null
  reasoning: string
  rules_notes: string
  ts: number
}

export function buildPredictionRows(
  predictions: Prediction[],
  universe: Map<string, UniverseMarket>,
): PredictionRow[] {
  const latest = latestPredictionsByMarket(predictions)
  return Array.from(latest.values())
    .map((p) => {
      const marketId = String(p.market_id)
      return {
        market_id: marketId,
        question: universeQuestion(universe, marketId),
        cohort: universe.get(marketId)?.cohort ?? null,
        rule_flag: universe.get(marketId)?.rule_flag ?? null,
        rule_note: universe.get(marketId)?.rule_note ?? null,
        p: p.p,
        mid_at_prediction: p.mid_at_prediction,
        divergence: Math.round((p.p - p.mid_at_prediction) * 1000) / 1000,
        confidence: p.confidence,
        trigger: p.trigger ?? null,
        reasoning: p.reasoning,
        rules_notes: p.rules_notes,
        ts: p.ts,
      }
    })
    // 分歧最大的排前面 —— 这是"信号最强"的预测,也是最值得人工核验的
    .sort((a, b) => Math.abs(b.divergence) - Math.abs(a.divergence))
}

export interface SettlementRow {
  market_id: string
  question: string
  cohort: string | null
  p: number
  outcome: number
  filled: boolean
  pnl: number
  brier_claude: number
  brier_market: number
  resolve_ts: number
}

export function buildSettlementRows(settlements: Settlement[]): SettlementRow[] {
  return settlements
    .map((s) => ({
      market_id: s.market_id,
      question: s.question ?? `(市场 ${s.market_id})`,
      cohort: s.cohort ?? null,
      p: s.p,
      outcome: s.outcome,
      filled: s.filled,
      pnl: s.pnl,
      brier_claude: s.brier_claude,
      brier_market: s.brier_market,
      resolve_ts: s.resolve_ts,
    }))
    .sort((a, b) => b.resolve_ts - a.resolve_ts)
}
