import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fetchGlmUsage } from "@/lib/glm-usage"
import { GLM_MAX_BYTES } from "@/lib/glm-usage-pure"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "glm-usage-"))
  vi.stubEnv("PORTAL_STATE_DIR", dir)
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})

const minimal = (generated_at: string) =>
  JSON.stringify({
    schema: 1,
    kind: "glm-usage",
    generated_at,
    month: "2026-09",
    today: "2026-09-15",
    hosts: [],
    windows: { month: { totals: { total: 5 } }, today: { totals: {} } },
    quota: { status: "unavailable" },
  })

describe("fetchGlmUsage(fs 降级)", () => {
  it("缺帧 → missing", async () => {
    const r = await fetchGlmUsage()
    expect(r).toMatchObject({ ok: false, kind: "missing" })
  })

  it("正常帧 → ok", async () => {
    writeFileSync(path.join(dir, "glm-usage.json"), minimal("2026-09-15T06:59:00Z"))
    const r = await fetchGlmUsage(Date.parse("2026-09-15T07:00:00Z"))
    expect(r.ok && r.data.windows.month.totals.total).toBe(5)
  })

  it("超过大小上限 → io 过大, 不解析", async () => {
    writeFileSync(path.join(dir, "glm-usage.json"), " ".repeat(GLM_MAX_BYTES + 1))
    const r = await fetchGlmUsage()
    expect(r).toMatchObject({ ok: false, kind: "io" })
    expect(!r.ok && r.error).toContain("过大")
  })

  it("恰好等于上限的坏 JSON → invalid(上限本身不误伤)", async () => {
    writeFileSync(path.join(dir, "glm-usage.json"), "x".repeat(GLM_MAX_BYTES))
    const r = await fetchGlmUsage()
    expect(r).toMatchObject({ ok: false, kind: "invalid" })
  })
})
