import { describe, it, expect } from "vitest"
import { clientIp } from "@/lib/auth"

// 限流等场景要的是「不可伪造的真实来源 IP」。NPM 用 $remote_addr 覆盖式写 X-Real-IP
// (攻击者伪造不了),故优先它;退化时取 X-Forwarded-For 的**最后一段**(NPM append 的
// 那项=NPM 见到的真 client),绝不取最左段(那是客户端自填、可伪造——portal 老洞之源)。
describe("clientIp", () => {
  it("优先 X-Real-IP(NPM 覆盖式、不可伪造)", () => {
    expect(clientIp("203.0.113.7", "192.168.0.1, 203.0.113.7")).toBe("203.0.113.7")
  })

  it("无 X-Real-IP → 取 XFF 最后一段(NPM append 的真 client),不取最左可伪造段", () => {
    // 攻击者把最左塞成 192.168.0.1 也没用:取的是最后一段
    expect(clientIp(null, "192.168.0.1, 198.51.100.9")).toBe("198.51.100.9")
  })

  it("XFF 单段 → 即为该段", () => {
    expect(clientIp(null, "198.51.100.9")).toBe("198.51.100.9")
  })

  it("两者皆无 → unknown(共用一个桶,不致命:TOTP 兜底)", () => {
    expect(clientIp(null, null)).toBe("unknown")
    expect(clientIp("", "")).toBe("unknown")
  })

  it("去空白", () => {
    expect(clientIp("  203.0.113.7  ", null)).toBe("203.0.113.7")
    expect(clientIp(null, "192.168.0.1 ,  198.51.100.9 ")).toBe("198.51.100.9")
  })
})
