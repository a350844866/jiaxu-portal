import { describe, it, expect } from "vitest"
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { ServiceGrid } from "@/components/dashboard/service-grid"
import type { ServiceDefinition } from "@/config/services"
import type { NetworkMode } from "@/lib/network-mode"

// SSR 首屏 HTML 的卡片 href 必须跟 page.tsx 传入的 initialNetworkMode 走,
// 不能等 hydration 后才换(2026-10-18 修的 hydration race)。服务端渲染只调
// getServerSnapshot——这里 node 环境没有 window,若误调 getSnapshot 会直接抛错。
const services: ServiceDefinition[] = [
  {
    id: "alpha",
    name: "Alpha",
    description: "公网有域名的服务",
    category: "my-projects",
    icon: "Code2",
    url: "https://alpha.example.com",
    healthUrl: "http://192.168.31.66:4100/health",
  },
  {
    id: "beta",
    name: "Beta",
    description: "仅内网",
    category: "my-projects",
    icon: "Code2",
    url: "http://192.168.31.66:4200",
    healthUrl: "http://192.168.31.66:4200",
    internalOnly: true,
  },
]

function ssr(initialNetworkMode?: NetworkMode): string {
  return renderToString(createElement(ServiceGrid, { services, initialHealth: [], initialNetworkMode }))
}

describe("ServiceGrid SSR 网络模式初值", () => {
  it("internal:href 直接是内网直连,仅内网服务可点", () => {
    const html = ssr("internal")
    expect(html).toContain('href="http://192.168.31.66:4100"')
    expect(html).toContain('href="http://192.168.31.66:4200"')
    expect(html).not.toContain('href="https://alpha.example.com"')
    expect(html).toContain("内网模式")
  })

  it("external:href 是公网域名,仅内网服务不出链接", () => {
    const html = ssr("external")
    expect(html).toContain('href="https://alpha.example.com"')
    expect(html).not.toContain('href="http://192.168.31.66:4100"')
    expect(html).not.toContain('href="http://192.168.31.66:4200"')
    expect(html).toContain("外网模式")
  })

  it("不传 initialNetworkMode → external(与改前默认一致)", () => {
    const html = ssr()
    expect(html).toContain('href="https://alpha.example.com"')
    expect(html).toContain("外网模式")
  })
})
