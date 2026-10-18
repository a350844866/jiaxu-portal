"use client"

import { useSyncExternalStore } from "react"
import { modeFromHost, type NetworkMode } from "@/lib/network-mode"

export type { NetworkMode }

// 页面生命周期内 hostname 不会变,无需订阅;模块级常量保证引用稳定、不反复重订阅
const subscribe = () => () => {}
const getSnapshot = () => modeFromHost(window.location.hostname)

/**
 * initialMode 由 SSR 按请求 Host 算好传入(page.tsx),首屏 HTML 与 hydration 用它,
 * 卡片 href 一开始就是对的。hydration 后 React 会拿 getSnapshot()(浏览器真实 hostname)
 * 与它比对,不同则重渲——双向校正,internal↔external 都能纠回来。
 * 用 useSyncExternalStore 而非 useState+useEffect:后者是 hydration 后同步 setState,
 * 正是 react-hooks/set-state-in-effect 要拦的写法。
 * 切勿改回 useState(initialMode):那会丢掉 hydration 后的校正,反代改写 Host 时外网用户
 * 会永久卡在内网链接上——现有测试(node 环境、只测 SSR)拦不住这种回退。
 */
export function useNetworkMode(initialMode: NetworkMode = "external"): NetworkMode {
  return useSyncExternalStore(subscribe, getSnapshot, () => initialMode)
}
