import { CategoryDefinition } from "./services"

export const categories: CategoryDefinition[] = [
  {
    id: "my-projects",
    label: "我的项目",
    description: "自己开发和维护的应用",
    icon: "Code2",
  },
  {
    id: "media",
    label: "媒体娱乐",
    description: "影音、下载、字幕管理",
    icon: "Film",
  },
  {
    id: "iot-vehicle",
    label: "智能家居 & 车辆",
    description: "Home Assistant、TeslaMate",
    icon: "Home",
  },
  {
    id: "cloud-files",
    label: "云存储 & 文件",
    description: "照片、文件同步、网盘",
    icon: "Cloud",
  },
  {
    id: "monitoring-admin",
    label: "监控 & 运维",
    description: "服务器管理、容器、网络",
    icon: "LayoutDashboard",
  },
]
