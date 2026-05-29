import { promises as fs } from "node:fs"
import path from "node:path"
import { parseLikes, parseLedger, type Ledger, type Tweet } from "@/lib/serenity-pure"

// Re-export pure types + helpers so existing "@/lib/serenity-reader" imports keep working.
// Server-only IO (node:fs) stays in this module; client components should import
// types/filterTweets from "@/lib/serenity-pure" to avoid bundling node:fs.
export {
  parseLikes,
  parseLedger,
  filterTweets,
  tweetCountByDay,
  tickerMentionCounts,
  verdictBreakdown,
} from "@/lib/serenity-pure"
export type {
  Stance,
  Verdict,
  Position,
  Prediction,
  Catalyst,
  Ledger,
  Tweet,
  TweetFilter,
} from "@/lib/serenity-pure"

// Resolved at call time (not module load) so tests can override SERENITY_CORPUS_DIR.
function corpusDir(): string {
  return process.env.SERENITY_CORPUS_DIR || "/data/x-corpus"
}

export async function readLedger(): Promise<
  { ok: true; ledger: Ledger; ageSeconds: number } | { ok: false; error: string }
> {
  try {
    const ledgerPath = path.join(corpusDir(), "ledger.json")
    const stat = await fs.stat(ledgerPath)
    const raw = await fs.readFile(ledgerPath, "utf-8")
    return { ok: true, ledger: parseLedger(raw), ageSeconds: Math.round((Date.now() - stat.mtimeMs) / 1000) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function readTweets(): Promise<
  { ok: true; tweets: Tweet[]; ageSeconds: number } | { ok: false; error: string }
> {
  try {
    const tweetsPath = path.join(corpusDir(), "tweets-full.json")
    const stat = await fs.stat(tweetsPath)
    const raw = await fs.readFile(tweetsPath, "utf-8")
    const arr = JSON.parse(raw)
    const list: unknown[] = Array.isArray(arr) ? arr : arr.tweets ?? []
    const tweets: Tweet[] = list.map((x) => {
      const o = x as Record<string, unknown>
      const likesRaw = String(o.likes ?? "0")
      return {
        id: String(o.id ?? ""),
        text: String(o.text ?? ""),
        timestamp: String(o.timestamp ?? ""),
        likes: parseLikes(likesRaw),
        likesRaw,
        url: String(o.url ?? ""),
      }
    })
    return { ok: true, tweets, ageSeconds: Math.round((Date.now() - stat.mtimeMs) / 1000) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
