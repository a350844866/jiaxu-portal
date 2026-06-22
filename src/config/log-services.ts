/**
 * 生产日志查看器 — 服务清单(单一真相源)
 *
 * name = 生产 Nacos `product` 命名空间注册名;container = vlogs 容器名。
 * 3 处「注册名 ≠ 容器名」已映射:4gcard→my4gcard / auto-itsm-server→auto-itsm-core /
 * internal-manage-web→internal-manage-web-server。新增 Nacos 服务在此加一行。
 */
export type LogService = { name: string; container: string }
export type LogGroup = { group: string; services: LogService[] }

export const LOG_GROUPS: LogGroup[] = [
  {
    group: "登录链路",
    services: [
      { name: "auth-web", container: "auth-web" },
      { name: "auth-server", container: "auth-server" },
      { name: "sms-server", container: "sms-server" },
      { name: "staff-server", container: "staff-server" },
      { name: "staff-4a-server", container: "staff-4a-server" },
      { name: "staff-4a-msg-receive-server", container: "staff-4a-msg-receive-server" },
    ],
  },
  {
    group: "金牌",
    services: [
      { name: "golden-service-server", container: "golden-service-server" },
      { name: "golden-service-web", container: "golden-service-web" },
    ],
  },
  {
    group: "工作流",
    services: [
      { name: "activiti", container: "activiti" },
      { name: "seata-server", container: "seata-server" },
    ],
  },
  {
    group: "open 平台",
    services: [
      { name: "open-api", container: "open-api" },
      { name: "open-server", container: "open-server" },
      { name: "open-dingtalk-server", container: "open-dingtalk-server" },
    ],
  },
  {
    group: "内部管理",
    services: [
      { name: "internal-manage-server", container: "internal-manage-server" },
      { name: "internal-manage-web", container: "internal-manage-web-server" },
    ],
  },
  {
    group: "其它业务",
    services: [
      { name: "oss-server", container: "oss-server" },
      { name: "ctdfs-server", container: "ctdfs-server" },
      { name: "form-server", container: "form-server" },
      { name: "portal-web", container: "portal-web" },
      { name: "portal-server", container: "portal-server" },
      { name: "4gcard", container: "my4gcard" },
      { name: "auto-itsm-server", container: "auto-itsm-core" },
      { name: "auto-itsm-web", container: "auto-itsm-web" },
      { name: "big-data-middle-platform-sync-server", container: "big-data-middle-platform-sync-server" },
      { name: "integrity-business-management-server", container: "integrity-business-management-server" },
      { name: "integrity-business-management-web", container: "integrity-business-management-web" },
      { name: "data-inspection-server", container: "data-inspection-server" },
      { name: "data-inspection-web", container: "data-inspection-web" },
    ],
  },
]

const ALL: LogService[] = LOG_GROUPS.flatMap((g) => g.services)

export function serviceByName(name: string): LogService | undefined {
  return ALL.find((s) => s.name === name)
}

export function containerOf(name: string): string | undefined {
  return serviceByName(name)?.container
}

export function allContainers(): string[] {
  return [...new Set(ALL.map((s) => s.container))]
}

export function isKnownService(name: string): boolean {
  return ALL.some((s) => s.name === name)
}
