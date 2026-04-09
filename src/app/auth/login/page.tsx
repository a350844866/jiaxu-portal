"use client"

import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Shield, Loader2, Eye, EyeOff } from "lucide-react"

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get("redirect")
  const [password, setPassword] = useState("")
  const [totp, setTotp] = useState("")
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, totp }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "登录失败")
        return
      }
      // Redirect back to original URL if provided (only allow same base domain)
      if (redirectTo) {
        try {
          const url = new URL(redirectTo)
          const baseDomain = window.location.hostname.split(".").slice(-2).join(".")
          if (url.hostname.endsWith(baseDomain)) {
            window.location.href = redirectTo
            return
          }
        } catch { /* invalid URL, fall through */ }
      }
      router.push("/")
    } catch {
      setError("网络错误")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Password */}
      <div className="relative">
        <input
          type={showPw ? "text" : "password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="密码"
          autoComplete="current-password"
          className="w-full h-11 rounded-lg border border-zinc-700 bg-zinc-800/60 px-4 pr-10 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-500 transition-colors"
        />
        <button
          type="button"
          onClick={() => setShowPw(!showPw)}
          className="absolute right-3 top-3 text-zinc-500 hover:text-zinc-300"
        >
          {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>

      {/* TOTP */}
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        value={totp}
        onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
        placeholder="6 位验证码"
        autoComplete="one-time-code"
        className="w-full h-11 rounded-lg border border-zinc-700 bg-zinc-800/60 px-4 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-500 transition-colors tracking-widest text-center"
      />

      {error && (
        <div className="text-xs text-red-400 bg-red-950/30 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !password || totp.length !== 6}
        className="w-full h-11 rounded-lg bg-zinc-100 text-zinc-900 text-sm font-medium hover:bg-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "登录"}
      </button>
    </form>
  )
}

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-800 text-zinc-300 mb-4">
            <Shield className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-semibold text-zinc-100">Jiaxu Portal</h1>
          <p className="text-xs text-zinc-500 mt-1">请输入密码和验证码</p>
        </div>

        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  )
}
