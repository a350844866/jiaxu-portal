import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { readChain, readQuotes } from "@/lib/ai-chain-reader"

// IO 层测试:env 目录运行时解析(非模块加载时),可用临时目录覆盖 —— 同 serenity-reader.test.ts 模式。
let dir: string
const OLD_VAULT = process.env.VAULT_DIR
const OLD_DATA = process.env.AI_CHAIN_DATA_DIR

const MINI_CHAIN = JSON.stringify({
  version: 1,
  updated: "2026-07-02",
  global: { stage: "s", debates: [] },
  segments: [{ id: "a", order: 1, name: "A", role: "r", focus: [], refs: [] }],
  stocks: [{ ticker: "NVDA", name: "n", segment: "a", position: "巨头", cp: "yes", desc: "d", note: "n", signals: [] }],
})

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ai-chain-"))
  process.env.VAULT_DIR = dir
  process.env.AI_CHAIN_DATA_DIR = dir
  await mkdir(path.join(dir, "wiki", "concepts"), { recursive: true })
})

afterAll(async () => {
  process.env.VAULT_DIR = OLD_VAULT
  process.env.AI_CHAIN_DATA_DIR = OLD_DATA
  await rm(dir, { recursive: true, force: true })
})

describe("readChain (IO layer)", () => {
  it("文件缺失 → {ok:false},页面走错误面板", async () => {
    const res = await readChain()
    expect(res.ok).toBe(false)
  })

  it("正常读取带 ageSeconds", async () => {
    await writeFile(path.join(dir, "wiki", "concepts", "ai-chain.json"), MINI_CHAIN)
    const res = await readChain()
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.chain.stocks[0].ticker).toBe("NVDA")
      expect(res.ageSeconds).toBeGreaterThanOrEqual(0)
      expect(res.ageSeconds).toBeLessThan(60)
    }
  })

  it("JSON 损坏 → {ok:false} 而非抛错", async () => {
    await writeFile(path.join(dir, "wiki", "concepts", "ai-chain.json"), "{broken")
    const res = await readChain()
    expect(res.ok).toBe(false)
  })
})

describe("readQuotes (IO layer)", () => {
  it("quotes.json 缺失(首次 cron 前)→ {ok:false},页面显示未就绪但可用", async () => {
    const res = await readQuotes()
    expect(res.ok).toBe(false)
  })

  it("正常读取", async () => {
    await writeFile(
      path.join(dir, "quotes.json"),
      JSON.stringify({ updated: "2026-07-02T07:30:00+08:00", quotes: { NVDA: { price: 190.1, chg1d: 1.1 } } }),
    )
    const res = await readQuotes()
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.quotes.quotes.NVDA.price).toBe(190.1)
  })
})
