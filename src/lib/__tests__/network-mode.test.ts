import { describe, it, expect } from "vitest"
import { hostnameOf, modeFromHost, requestHost } from "@/lib/network-mode"

// 同一条规则服务 SSR(请求 Host 头,带端口)与客户端(location.hostname,IPv6 带方括号)。
describe("hostnameOf", () => {
  it("剥端口", () => {
    expect(hostnameOf("192.168.31.66:3200")).toBe("192.168.31.66")
    expect(hostnameOf("portal.example.com:443")).toBe("portal.example.com")
  })

  it("无端口原样", () => {
    expect(hostnameOf("192.168.31.66")).toBe("192.168.31.66")
    expect(hostnameOf("portal.example.com")).toBe("portal.example.com")
  })

  it("IPv6:方括号(带/不带端口)剥掉,裸 IPv6 多冒号不当端口切", () => {
    expect(hostnameOf("[::1]:3200")).toBe("::1")
    expect(hostnameOf("[::1]")).toBe("::1")
    expect(hostnameOf("::1")).toBe("::1")
    expect(hostnameOf("fe80::1")).toBe("fe80::1")
  })

  it("转小写 + 去空白", () => {
    expect(hostnameOf("  LocalHost:3000 ")).toBe("localhost")
  })

  it("畸形值原样返回,不拼出内网形态", () => {
    expect(hostnameOf("[::1].example.com")).toBe("[::1].example.com")
    expect(hostnameOf("[::1")).toBe("[::1")
    expect(hostnameOf("[::1]:abc")).toBe("[::1]:abc")
    expect(hostnameOf("192.168.31.66:abc")).toBe("192.168.31.66:abc")
  })
})

describe("modeFromHost", () => {
  it("家里 LAN 192.168.31.x(带/不带端口)→ internal", () => {
    expect(modeFromHost("192.168.31.66:3200")).toBe("internal")
    expect(modeFromHost("192.168.31.66")).toBe("internal")
    expect(modeFromHost("192.168.31.2")).toBe("internal")
  })

  it("本机回环 localhost / 127.0.0.1 / ::1(含端口、方括号)→ internal", () => {
    expect(modeFromHost("localhost:3000")).toBe("internal")
    expect(modeFromHost("localhost")).toBe("internal")
    expect(modeFromHost("127.0.0.1:3200")).toBe("internal")
    expect(modeFromHost("[::1]:3200")).toBe("internal")
    expect(modeFromHost("[::1]")).toBe("internal")
    expect(modeFromHost("::1")).toBe("internal")
  })

  it("公网域名 → external", () => {
    expect(modeFromHost("portal.example.com")).toBe("external")
    expect(modeFromHost("portal.example.com:443")).toBe("external")
  })

  it("别的网段 / Tailscale / 形似 LAN 的域名 → external", () => {
    expect(modeFromHost("192.168.1.5:3200")).toBe("external")
    expect(modeFromHost("100.64.0.7:3200")).toBe("external")
    expect(modeFromHost("192.168.31.66.example.com")).toBe("external")
    expect(modeFromHost("x192.168.31.66")).toBe("external")
  })

  it("畸形 / 伪造 Host(方括号后缀、缺右括号、非数字端口、越界段)→ external", () => {
    expect(modeFromHost("[::1].example.com")).toBe("external")
    expect(modeFromHost("[::1")).toBe("external")
    expect(modeFromHost("[::1]:abc")).toBe("external")
    expect(modeFromHost("192.168.31.66:abc")).toBe("external")
    expect(modeFromHost("localhost:")).toBe("external")
    expect(modeFromHost("192.168.31.256")).toBe("external")
    expect(modeFromHost("192.168.31.0066")).toBe("external")
    expect(modeFromHost("192.168.31.255:3200")).toBe("internal")
  })

  it("空值 → external(与改前的默认一致)", () => {
    expect(modeFromHost(null)).toBe("external")
    expect(modeFromHost(undefined)).toBe("external")
    expect(modeFromHost("")).toBe("external")
  })
})

describe("requestHost", () => {
  it("X-Forwarded-Host 优先于 Host", () => {
    expect(requestHost("portal.example.com", "192.168.31.66:3200")).toBe("portal.example.com")
  })

  it("X-Forwarded-Host 多段取首段(最外层代理见到的 Host)", () => {
    expect(requestHost("portal.example.com, 192.168.31.66:3200", "x")).toBe("portal.example.com")
  })

  it("X-Forwarded-Host 缺失 / 空 → 退化 Host", () => {
    expect(requestHost(null, "192.168.31.66:3200")).toBe("192.168.31.66:3200")
    expect(requestHost("", "192.168.31.66:3200")).toBe("192.168.31.66:3200")
    expect(requestHost(" , ", " 192.168.31.66:3200 ")).toBe("192.168.31.66:3200")
  })

  it("两者皆无 → null(modeFromHost 再兜成 external)", () => {
    expect(requestHost(null, null)).toBeNull()
    expect(modeFromHost(requestHost(null, null))).toBe("external")
  })
})
