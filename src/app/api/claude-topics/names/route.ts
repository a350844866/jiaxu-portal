/**
 * 战线显示名的读写接口（唯一权威源 = /data/ws-names/workstream-names.conf，rw 挂载）。
 *
 *   GET  → { ids, defaults, current, revision, file, editable }
 *   PUT  → { names: {<id>: <名字|"">}, base_revision? }
 *          "" = 删除该覆盖、回落内置默认名；base_revision 不匹配则 409
 *
 * 鉴权：走 proxy.ts 全局会话门禁（未登录被重写到 /auth/login，同 surge-rules 写接口）。
 *
 * 安全与一致性边界（2026-07-30 经 Codex 对抗审查后加固，逐条对应审查发现）：
 *  - **id 白名单**取自快照 meta.workstream_ids（生成侧下发）；未知 id 直接 400 拒绝，
 *    不静默忽略——静默会让用户以为改生效了。
 *  - **名字消毒**：conf 是 `id = name` 行格式，名字里的换行/`#`/`=` 会破坏或伪造配置行。
 *  - **读失败不等于空配置**：只有 ENOENT 才当「初始为空」；EACCES/EIO 一律中止，
 *    否则会用空配置 rename 覆盖掉一个其实还在的权威文件。
 *  - **每请求独立 tmp 文件**：固定 tmp 名会让并发 PUT 互相 rename 对方的内容
 *    （一个拿到 ENOENT，另一个把半截内容变成正式文件）。
 *  - **乐观并发**：base_revision 不匹配 → 409，避免后保存者静默覆盖前一个人的修改。
 *  - **body 上限前置**：先看 Content-Length，再 req.json()——否则限制发生在完整缓冲之后，
 *    拦不住内存耗尽。
 *  - **解析语义与 Python 侧对齐**：都吃 BOM、都支持 LF/CRLF/CR。JS `trim()` 会去掉 BOM 而
 *    Python `strip()` 不会，不统一会造成「网页读得到、脚本当未知 id 丢掉」的静默错位。
 *  - 名字**不参与分类**（classify_topic 不读这张表），所以最坏后果是标签难看，
 *    改不动任何金额或归类。这是敢把它做成网页可写的前提。
 */
import { NextResponse } from "next/server"
import { promises as fs } from "node:fs"
import { createHash, randomBytes } from "node:crypto"
import path from "node:path"
import { fetchTopicSnapshot } from "@/lib/claude-topics"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NAMES_DIR = process.env.WORKSTREAM_NAMES_DIR || "/data/ws-names"
const NAMES_FILE = path.join(NAMES_DIR, "workstream-names.conf")

const MAX_NAME_LEN = 40
const MAX_ENTRIES = 64
/** 32KB 够 11 条名字用几百倍；超了直接拒，不进 JSON.parse */
const MAX_BODY_BYTES = 32 * 1024

type Loaded = { text: string; revision: string } | { missing: true }

/** revision = 文件字节的 sha256 前 12 位，与 Python 侧同算法（便于比对「应用了哪一版」） */
function rev(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex").slice(0, 12)
}

/** 读 conf。ENOENT → missing；其它错误抛出（调用方必须中止，不能当空配置） */
async function loadConf(): Promise<Loaded> {
  let buf: Buffer
  try {
    buf = await fs.readFile(NAMES_FILE)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { missing: true }
    throw e
  }
  // 与 Python 的 utf-8-sig 对齐：显式剥 BOM，不依赖 trim() 的隐式行为
  let text = buf.toString("utf8")
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  return { text, revision: rev(buf) }
}

/** 解析 `id = 名字`。行切分吃 LF/CRLF/CR，与 Python splitlines() 同语义 */
function parseConf(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.split("#")[0].trim()
    if (!line || !line.includes("=")) continue
    const i = line.indexOf("=")
    const k = line.slice(0, i).trim()
    const v = line.slice(i + 1).trim()
    if (k && v) out[k] = v
  }
  return out
}

/** 消毒显示名。null = 视为「清空该覆盖」（回落默认名） */
function sanitizeName(v: unknown): string | null {
  if (typeof v !== "string") return null
  const cleaned = v
    // 控制字符 + BOM → 空格：换行会把一行拆两行，等于往 conf 注入配置行
    .replace(/[\u0000-\u001F\u007F\uFEFF]/g, " ")
    // `#` 会被当注释吞掉后半段；`=` 会让 `id = name` 的切分产生歧义
    .replace(/[#=]/g, "")
    .replace(/\s+/g, " ")
    .trim()
  if (!cleaned) return null
  return cleaned.slice(0, MAX_NAME_LEN)
}

function serializeConf(names: Record<string, string>, order: string[]): string {
  const lines = [
    "# 战线显示名 —— jiaxu-portal 首页「Claude 用量归因」卡片可直接编辑保存。",
    "# 也可以手改本文件；格式 `id = 显示名`，# 注释、空行随意。",
    "#",
    "# 左边的 id 不要改（分类器内部键）。名字只影响显示，不参与分类。",
    "# 只列出被自定义的战线；没列出的自动用内置默认名（所以删掉一行 = 恢复默认）。",
    "# 保存后 ≤5 分钟被家服快照 timer 读到，卡片随之更新。",
    "",
  ]
  const width = Math.max(...order.map((k) => k.length), 1)
  for (const id of order) {
    const v = names[id]
    if (v) lines.push(`${id.padEnd(width)} = ${v}`)
  }
  return lines.join("\n") + "\n"
}

async function legalIds(): Promise<{ ids: string[]; defaults: Record<string, string> } | null> {
  const snap = await fetchTopicSnapshot()
  if (!snap.ok) return null
  const meta = snap.data.meta as unknown as {
    workstream_ids?: string[]
    workstream_defaults?: Record<string, string>
  }
  if (!Array.isArray(meta.workstream_ids) || !meta.workstream_ids.length) return null
  return { ids: meta.workstream_ids, defaults: meta.workstream_defaults ?? {} }
}

export async function GET() {
  const legal = await legalIds()
  let current: Record<string, string> = {}
  let revision: string | null = null
  try {
    const c = await loadConf()
    if (!("missing" in c)) {
      current = parseConf(c.text)
      revision = c.revision
    }
  } catch (e) {
    // 读失败不能伪装成 current={} —— 那会让前端以为「还没自定义过」并提交覆盖
    return NextResponse.json(
      {
        error: "读配置失败: " + (e instanceof Error ? e.message : String(e)),
        editable: false,
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    )
  }
  return NextResponse.json(
    {
      file: NAMES_FILE,
      ids: legal?.ids ?? [],
      defaults: legal?.defaults ?? {},
      current,
      revision,
      editable: !!legal,
    },
    { headers: { "Cache-Control": "no-store" } }
  )
}

export async function PUT(req: Request) {
  // body 上限前置：先看 Content-Length，避免限制发生在完整缓冲之后
  const declared = Number(req.headers.get("content-length") ?? "0")
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: `请求体过大（上限 ${MAX_BODY_BYTES} 字节）` },
      { status: 413 }
    )
  }
  const rawText = await req.text()
  if (Buffer.byteLength(rawText, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: `请求体过大（上限 ${MAX_BODY_BYTES} 字节）` },
      { status: 413 }
    )
  }

  let body: unknown
  try {
    body = JSON.parse(rawText)
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 })
  }
  const incoming = (body as { names?: unknown })?.names
  const baseRevision = (body as { base_revision?: unknown })?.base_revision
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return NextResponse.json({ error: "需要 names 对象" }, { status: 400 })
  }
  const entries = Object.entries(incoming as Record<string, unknown>)
  if (entries.length > MAX_ENTRIES) {
    return NextResponse.json({ error: `一次最多 ${MAX_ENTRIES} 条` }, { status: 400 })
  }

  const legal = await legalIds()
  if (!legal) {
    return NextResponse.json(
      { error: "读不到快照，无法校验战线 id（宿主 timer 是否在跑？）" },
      { status: 503 }
    )
  }
  const bad = entries.filter(([k]) => !legal.ids.includes(k)).map(([k]) => k)
  if (bad.length) {
    return NextResponse.json(
      { error: `非法战线 id: ${bad.join(", ")}`, legal_ids: legal.ids },
      { status: 400 }
    )
  }

  // 读当前盘上内容作为基线。读失败（非 ENOENT）必须中止——否则会用空配置覆盖真文件
  let merged: Record<string, string> = {}
  let currentRevision: string | null = null
  try {
    const c = await loadConf()
    if (!("missing" in c)) {
      merged = parseConf(c.text)
      currentRevision = c.revision
    }
  } catch (e) {
    return NextResponse.json(
      { error: "读现有配置失败，已中止保存（不覆盖）: " + (e instanceof Error ? e.message : String(e)) },
      { status: 500 }
    )
  }

  // 乐观并发：调用方给了 base_revision 就必须与盘上一致，否则让它重新加载再合并
  if (typeof baseRevision === "string" && baseRevision !== (currentRevision ?? "")) {
    return NextResponse.json(
      {
        error: "配置已被其它地方修改，请重新加载后再保存",
        your_base: baseRevision,
        current_revision: currentRevision,
      },
      { status: 409 }
    )
  }

  const sanitized: string[] = []
  const unset: string[] = []
  for (const [k, v] of entries) {
    const clean = sanitizeName(v)
    if (clean === null) {
      delete merged[k] // 空值 = 删掉覆盖，回落内置默认名
      unset.push(k)
      continue
    }
    if (clean !== String(v).trim()) sanitized.push(k)
    merged[k] = clean
  }

  const text = serializeConf(merged, legal.ids)
  // 每请求独立 tmp：固定名会让并发 PUT 互相 rename 对方的内容
  const tmp = `${NAMES_FILE}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`
  let newRevision: string
  try {
    await fs.writeFile(tmp, text, "utf8")
    newRevision = rev(Buffer.from(text, "utf8"))
    await fs.rename(tmp, NAMES_FILE) // 同目录 rename 原子，读者永远看不到半截
  } catch (e) {
    try {
      await fs.unlink(tmp)
    } catch {
      /* tmp 可能没建出来 */
    }
    return NextResponse.json(
      { error: "写入失败: " + (e instanceof Error ? e.message : String(e)) },
      { status: 500 }
    )
  }

  return NextResponse.json(
    {
      ok: true,
      file: NAMES_FILE,
      revision: newRevision,
      overrides: merged,
      unset,
      sanitized,
      note: "已落盘；家服快照 timer ≤5 分钟读到后卡片才更新",
    },
    { headers: { "Cache-Control": "no-store" } }
  )
}
