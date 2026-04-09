import { readFile, writeFile, mkdir } from "fs/promises"
import { join } from "path"
import bcrypt from "bcryptjs"
import { generateSecret, generateURI, verifySync } from "otplib"
import { SignJWT, jwtVerify } from "jose"
import { randomBytes } from "crypto"

const AUTH_DIR = process.env.AUTH_DIR || "./data/auth"
const CONFIG_PATH = join(AUTH_DIR, "config.json")
const COOKIE_NAME = "portal_session"
const JWT_EXPIRY = "7d"
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
  return {
    name: COOKIE_NAME,
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
    // Set cookie on base domain for cross-subdomain SSO
    ...(host ? { domain: `.${host.split(".").slice(-2).join(".")}` } : {}),
  }
}

// ── Network detection ──

export function isInternalRequest(ip: string | null, host: string | null): boolean {
  if (!ip && !host) return false
  // Check host
  if (host) {
    const hostname = host.split(":")[0]
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      /^192\.168\.\d+\.\d+$/.test(hostname) ||
      /^10\.\d+\.\d+\.\d+$/.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(hostname)
    ) {
      return true
    }
  }
  // Check IP
  if (ip) {
    const realIp = ip.split(",")[0].trim()
    if (
      realIp === "127.0.0.1" ||
      realIp === "::1" ||
      /^192\.168\./.test(realIp) ||
      /^10\./.test(realIp) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(realIp)
    ) {
      return true
    }
  }
  return false
}
