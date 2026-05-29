"use client"
import { useState } from "react"
import type { Position, Tweet } from "@/lib/serenity-reader"
import { HoldingsGrid } from "./holdings-grid"
import { TickerDrawer } from "./ticker-drawer"

export function HoldingsSection({ positions, tweets }: { positions: Position[]; tweets: Tweet[] }) {
  const [ticker, setTicker] = useState<string | null>(null)
  return (
    <>
      <HoldingsGrid positions={positions} onPickTicker={setTicker} />
      <TickerDrawer ticker={ticker} tweets={tweets} onClose={() => setTicker(null)} />
    </>
  )
}
