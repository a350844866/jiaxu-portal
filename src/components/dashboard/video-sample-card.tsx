/**
 * VideoSampleCard — 抖音短视频样片预览(临时卡片).
 *
 * 视频文件: public/samples/douyin-googlebook.mp4
 *   - gitignore 排除(大二进制,不入公开 repo),但 Dockerfile `COPY public`
 *     会在 build 时打进镜像 → 运行时 /samples/douyin-googlebook.mp4 静态可访问.
 *   - 换样片只需覆盖该文件并 `docker compose up -d --build`.
 *
 * 来源: heygem-bridge/test-run 证据型科技快评样片,Claude+Codex 双 agent
 * 迭代 5 轮评分至 90+(详见 vault [[auto-content 视频化]]).
 *
 * 临时性质: 用户验收后此卡片可下线.
 */
import { Film } from "lucide-react"

export function VideoSampleCard() {
  return (
    <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/40">
      <details className="group" open>
        <summary className="flex cursor-pointer list-none items-center justify-between p-4 hover:bg-zinc-900/30">
          <div className="flex flex-wrap items-center gap-2">
            <Film className="h-4 w-4 text-sky-400" />
            <span className="text-sm font-medium text-zinc-200">
              抖音样片预览
            </span>
            <span className="text-xs text-zinc-500">
              Googlebook 证据型快评 · 51s · 9:16
            </span>
            <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
              Codex 92.3 / 子agent 90.7
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span className="text-zinc-600 group-open:hidden">展开 ▾</span>
            <span className="hidden text-zinc-600 group-open:inline">收起 ▴</span>
          </div>
        </summary>

        <div className="px-4 pb-4">
          <div className="mx-auto max-w-[300px]">
            <video
              controls
              playsInline
              preload="metadata"
              className="w-full rounded-xl border border-zinc-800 bg-black"
            >
              <source src="/samples/douyin-googlebook.mp4" type="video/mp4" />
              你的浏览器不支持 video 标签。
            </video>
          </div>
          <p className="mt-2 text-center text-[11px] leading-relaxed text-zinc-500">
            「贾诩看世界 · AI 前沿」· 主题 Google Googlebook
            <br />
            Claude + Codex 双 agent 迭代 5 轮评分至 90+ · 等你的意见
          </p>
        </div>
      </details>
    </section>
  )
}
