"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Shield, Loader2, Eye, EyeOff, CheckCircle } from "lucide-react"

export default function SetupPage() {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2>(1) // 1=password, 2=totp
  const [password, setPassword] = useState("")
  const [confirmPw, setConfirmPw] = useState("")
  const [showPw, setShowPw] = useState(false)
  const [totpSecret, setTotpSecret] = useState("")
  const [qrDataUrl, setQrDataUrl] = useState("")
  const [totpCode, setTotpCode] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  // Load QR code when entering step 2
  useEffect(() => {
    if (step === 2 && !qrDataUrl) {
      fetch("/api/auth/totp-qr")
        .then((r) => r.json())
        .then((data) => {
          if (data.secret) {
            setTotpSecret(data.secret)
            setQrDataUrl(data.qrDataUrl)
          }
        })
        .catch(() => setError("无法生成二维码"))
    }
  }, [step, qrDataUrl])

  function handleStep1(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    if (password.length < 6) {
      setError("密码至少 6 位")
      return
    }
    if (password !== confirmPw) {
      setError("两次密码不一致")
      return
    }
    setStep(2)
  }

  async function handleStep2(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, totpSecret, totpCode }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "设置失败")
        return
      }
      router.push("/")
    } catch {
      setError("网络错误")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-950/60 text-emerald-400 mb-4">
            <Shield className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-semibold text-zinc-100">初始设置</h1>
          <p className="text-xs text-zinc-500 mt-1">
            {step === 1 ? "第 1 步：设置密码" : "第 2 步：绑定验证器"}
          </p>
        </div>

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className={`h-1.5 w-8 rounded-full ${step >= 1 ? "bg-emerald-500" : "bg-zinc-700"}`} />
          <div className={`h-1.5 w-8 rounded-full ${step >= 2 ? "bg-emerald-500" : "bg-zinc-700"}`} />
        </div>

        {step === 1 && (
          <form onSubmit={handleStep1} className="space-y-4">
            <div className="relative">
              <input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="设置密码（至少 6 位）"
                autoComplete="new-password"
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

            <input
              type={showPw ? "text" : "password"}
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              placeholder="确认密码"
              autoComplete="new-password"
              className="w-full h-11 rounded-lg border border-zinc-700 bg-zinc-800/60 px-4 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-500 transition-colors"
            />

            {error && (
              <div className="text-xs text-red-400 bg-red-950/30 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!password || !confirmPw}
              className="w-full h-11 rounded-lg bg-zinc-100 text-zinc-900 text-sm font-medium hover:bg-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              下一步
            </button>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={handleStep2} className="space-y-4">
            <div className="text-center">
              <p className="text-xs text-zinc-400 mb-3">
                用 Google Authenticator 或其他验证器扫描二维码
              </p>
              {qrDataUrl ? (
                <div className="inline-block rounded-xl bg-white p-3">
                  <img src={qrDataUrl} alt="TOTP QR Code" width={200} height={200} />
                </div>
              ) : (
                <div className="flex items-center justify-center h-[200px]">
                  <Loader2 className="h-5 w-5 text-zinc-500 animate-spin" />
                </div>
              )}
            </div>

            {totpSecret && (
              <div className="text-center">
                <p className="text-[10px] text-zinc-600 mb-1">手动输入密钥</p>
                <code className="text-xs text-zinc-400 bg-zinc-800 px-2 py-1 rounded select-all">
                  {totpSecret}
                </code>
              </div>
            )}

            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
              placeholder="输入 6 位验证码"
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
              disabled={loading || totpCode.length !== 6}
              className="w-full h-11 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <CheckCircle className="h-4 w-4" />
                  完成设置
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => { setStep(1); setError("") }}
              className="w-full text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              返回上一步
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
