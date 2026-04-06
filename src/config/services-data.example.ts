/**
 * Example service configuration.
 * Copy this file to services-data.ts and replace with your actual URLs.
 */
import { ServiceDefinition } from "./services"

export const services: ServiceDefinition[] = [
  {
    id: "my-app",
    name: "My App",
    description: "Your custom application",
    category: "my-projects",
    icon: "HeartPulse",
    url: "https://app.example.com",
    healthUrl: "http://192.168.1.100:8000",
    isOwn: true,
    tags: ["app", "dashboard"],
  },
  {
    id: "plex",
    name: "Plex",
    description: "Media server",
    category: "media",
    icon: "Play",
    url: "https://plex.example.com",
    healthUrl: "http://192.168.1.100:32400/identity",
    tags: ["plex", "media"],
  },
  {
    id: "homeassistant",
    name: "Home Assistant",
    description: "Home automation",
    category: "iot-vehicle",
    icon: "House",
    url: "https://ha.example.com",
    healthUrl: "http://192.168.1.100:8123",
    tags: ["homeassistant", "iot"],
  },
  {
    id: "immich",
    name: "Immich",
    description: "Photo management",
    category: "cloud-files",
    icon: "Images",
    url: "https://photos.example.com",
    healthUrl: "http://192.168.1.100:2283",
    tags: ["photo", "backup"],
  },
  {
    id: "uptime-kuma",
    name: "Uptime Kuma",
    description: "Uptime monitoring",
    category: "monitoring-admin",
    icon: "HeartHandshake",
    url: "https://status.example.com",
    healthUrl: "http://192.168.1.100:3001",
    tags: ["uptime", "monitor"],
  },
]
