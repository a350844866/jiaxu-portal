import { readFile, writeFile, mkdir } from "fs/promises"
import { join } from "path"
import bcrypt from "bcryptjs"
import { generateSecret, generateURI, verifySync } from "otplib"
import { SignJWT, jwtVerify } from "jose"
import { randomBytes } from "crypto"

const AUTH_DIR = process.env.AUTH_DIR || "./data/auth"
const CONFIG_PATH = join(AUTH_DIR, "config.json")
const COOKIE_NAME = "portal_session"
const JWT_EXPIRY = "30d"
const LOCKOUT_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 15 * 60 * 1000 // 15 minutes

// ── Rate limiting (in-memory) ──

interface RateLimit {
  attempts: number
  lockedUntil: number | null
}

const rateLimits = new Map<string, RateLimit>()

export function checkRateLimit(ip: string): { allowed: boolean; retryAfterMs?: number } {
  const entry = rateLimits.get(ip)
  if (!entry) return { allowed: true }

  if (entry.lockedUntil) {
    const remaining = entry.lockedUntil - Date.now()
    if (remaining > 0) {
      return { allowed: false, retryAfterMs: remaining }
    }
    // Lockout expired
    rateLimits.delete(ip)
    return { allowed: true }
  }
  return { allowed: true }
}

export function recordFailedAttempt(ip: string): void {
  const entry = rateLimits.get(ip) || { attempts: 0, lockedUntil: null }
  entry.attempts += 1
  if (entry.attempts >= LOCKOUT_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_DURATION_MS
  }
  rateLimits.set(ip, entry)
}

export function clearRateLimit(ip: string): void {
  rateLimits.delete(ip)
}

/**
 * 取可信来源 IP(限流等用)。NPM 用 $remote_addr 覆盖式写 X-Real-IP(攻击者伪造不了),
 * 故优先它;退化取 X-Forwarded-For 最后一段(NPM append 的那项=NPM 见到的真 client),
 * 绝不取最左段(客户端自填、可伪造——portal 老 XFF 洞之源);都没有→"unknown"。
 */
export function clientIp(xRealIp: string | null, xff: string | null): string {
  const real = xRealIp?.trim()
  if (real) return real
  const parts = (xff || "").split(",").map((s) => s.trim()).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : "unknown"
}

// ── Config persistence ──

interface AuthConfig {
  passwordHash: string
  totpSecret: string
  jwtSecret: string
}

let cachedConfig: AuthConfig | null = null

export async function getConfig(): Promise<AuthConfig | null> {
  if (cachedConfig) return cachedConfig
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8")
    cachedConfig = JSON.parse(raw)
    return cachedConfig
  } catch {
    return null
  }
}

export async function saveConfig(config: AuthConfig): Promise<void> {
  await mkdir(AUTH_DIR, { recursive: true })
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8")
  cachedConfig = config
}

export async function isSetupComplete(): Promise<boolean> {
  return (await getConfig()) !== null
}

// ── Password ──

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

// ── TOTP ──

export function generateTotpSecret(): string {
  return generateSecret()
}

export function getTotpUri(secret: string): string {
  return generateURI({ issuer: "Jiaxu Portal", label: "admin", secret })
}

export function verifyTotp(token: string, secret: string): boolean {
  const result = verifySync({ token, secret })
  return result.valid
}

// ── JWT Session ──

function getJwtSecretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

export async function createSessionToken(config: AuthConfig): Promise<string> {
  return new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(getJwtSecretKey(config.jwtSecret))
}

export async function verifySessionToken(token: string): Promise<boolean> {
  const config = await getConfig()
  if (!config) return false
  try {
    await jwtVerify(token, getJwtSecretKey(config.jwtSecret))
    return true
  } catch {
    return false
  }
}

export function generateJwtSecret(): string {
  return randomBytes(32).toString("base64url")
}

// ── Cookie helpers ──

export { COOKIE_NAME }

export function sessionCookieOptions(secure: boolean, host?: string) {
  const hostname = (host || "").split(":")[0]
  // 仅真实域名设跨子域 Domain(*.liulin.work SSO)。IP / localhost / 空 → host-only
  // cookie:浏览器对 IP host 的 Domain 属性(如 .31.66)直接拒收,会导致登录后 cookie
  // 存不下来、看似登录成功实则无会话(裸 IP 访问 portal 时踩过)。
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)
  const useDomain = hostname.includes(".") && !isIp && hostname !== "localhost"
  return {
    name: COOKIE_NAME,
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 30 * 24 * 60 * 60, // 30 days in seconds
    ...(useDomain ? { domain: `.${hostname.split(".").slice(-2).join(".")}` } : {}),
  }
}
