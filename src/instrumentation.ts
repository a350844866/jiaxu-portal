/**
 * Next.js Instrumentation Hook
 * 在 server runtime 启动时调一次, 用于引导后端 daemon (如 mac-mini-collector)
 */
export async function register() {
  // 仅在 Node.js runtime 启动 (edge / browser 不跑)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { start } = await import("./lib/mac-mini-collector")
    start()
  }
}
