import { describe, it, expect } from "vitest"
import {
  LOG_GROUPS,
  allContainers,
  containerOf,
  isKnownService,
  serviceByName,
} from "../log-services"

const all = LOG_GROUPS.flatMap((g) => g.services)

describe("log-services 配置", () => {
  it("有 28 个服务且名字唯一", () => {
    expect(all.length).toBe(28)
    expect(new Set(all.map((s) => s.name)).size).toBe(28)
  })

  it("3 处命名映射正确", () => {
    expect(containerOf("4gcard")).toBe("my4gcard")
    expect(containerOf("auto-itsm-server")).toBe("auto-itsm-core")
    expect(containerOf("internal-manage-web")).toBe("internal-manage-web-server")
  })

  it("常规服务名=容器名", () => {
    expect(containerOf("sms-server")).toBe("sms-server")
    expect(containerOf("auth-web")).toBe("auth-web")
  })

  it("allContainers 无重复且=28", () => {
    expect(allContainers().length).toBe(28)
    expect(new Set(allContainers()).size).toBe(28)
  })

  it("isKnownService / serviceByName", () => {
    expect(isKnownService("auth-web")).toBe(true)
    expect(isKnownService("nope")).toBe(false)
    expect(serviceByName("sms-server")).toEqual({ name: "sms-server", container: "sms-server" })
    expect(serviceByName("nope")).toBeUndefined()
  })

  it("每组非空、组名唯一", () => {
    expect(LOG_GROUPS.every((g) => g.services.length > 0)).toBe(true)
    expect(new Set(LOG_GROUPS.map((g) => g.group)).size).toBe(LOG_GROUPS.length)
  })
})
