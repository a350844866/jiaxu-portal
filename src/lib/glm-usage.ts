/**
 * glm-usage — 读宿主写的 cpclaude 用量快照(服务端, 只读 /data/portal-state/glm-usage.json).
 * 解析/降级文案全在 glm-usage-pure.ts; 本模块只管 fs. 永不 throw、永不挂:
 * 整个读取(open + read)共用一个 2s 截止, 且经同一个文件句柄最多读 上限+1 字节 ——
 * 不先 stat 再 readFile, 免得两步之间文件被原子替换成大文件而绕过上限.
 */
import { promises as fs } from "node:fs"
import path from "node:path"
import { GLM_MAX_BYTES, GLM_READ_TIMEOUT_MS, parseGlmSnapshot, readErrorResult, type GlmUsageResult } from "./glm-usage-pure"

function stateDir(): string {
  return process.env.PORTAL_STATE_DIR || "/data/portal-state"
}

function codedError(code: string): Error {
  return Object.assign(new Error(code), { code })
}

async function readCapped(file: string, maxBytes: number): Promise<string> {
  const fh = await fs.open(file, "r")
  try {
    const buf = Buffer.alloc(maxBytes + 1)
    let off = 0
    while (off < buf.length) {
      const { bytesRead } = await fh.read(buf, off, buf.length - off, off)
      if (bytesRead === 0) break
      off += bytesRead
    }
    if (off > maxBytes) throw codedError("TOO_LARGE")
    return buf.toString("utf8", 0, off)
  } finally {
    await fh.close()
  }
}

/**
 * Promise.race 的截止只让请求按时返回, 不会取消卡住的 open/read. 上一次读取还挂在 fs 里时复用同一个
 * promise, 不再新开 —— 同一时刻最多一个读取占着 libuv 线程池与 256KB 缓冲.
 */
let inflight: Promise<string> | null = null

function readSnapshot(): Promise<string> {
  if (!inflight) {
    inflight = readCapped(path.join(stateDir(), "glm-usage.json"), GLM_MAX_BYTES).finally(() => {
      inflight = null
    })
  }
  return inflight
}

export async function fetchGlmUsage(nowMs: number = Date.now()): Promise<GlmUsageResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(codedError("TimeoutError")), GLM_READ_TIMEOUT_MS)
  })
  try {
    const raw = await Promise.race([readSnapshot(), deadline])
    return parseGlmSnapshot(raw, nowMs)
  } catch (e) {
    return readErrorResult((e as NodeJS.ErrnoException).code ?? (e as Error)?.name ?? "unknown")
  } finally {
    clearTimeout(timer)
  }
}

export type { GlmUsageResult, GlmSnapshot, GlmBucket, GlmHost, GlmQuota } from "./glm-usage-pure"
