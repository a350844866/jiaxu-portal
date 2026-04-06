# Jiaxu Portal

A personal home server dashboard — a single unified entry point for all self-hosted services.

Built with Next.js 16 (App Router), TypeScript, Tailwind CSS, and shadcn/ui. Dark theme, server-side health checks, real-time status indicators, and search filtering.

## Features

- **Unified entry point** — all services in one place, grouped by category
- **Health monitoring** — server-side pings every 30s, green/red status dots per card
- **Search** — filter services by name, description, or tags
- **Internal / external URL separation** — card links open the public HTTPS domain; health checks hit the internal LAN IP directly (no DNS, no external roundtrip)
- **"Own projects" highlight** — your own apps get a larger card with green accent border
- **Responsive** — 1 → 2 → 3 → 4 column grid from mobile to wide desktop
- **Docker-ready** — multi-stage standalone build, `docker compose up --build`

## Categories

| Category | Examples |
|----------|---------|
| My Projects | Custom apps you've built |
| Media | Plex, Emby, qBittorrent, Sonarr, Radarr |
| IoT & Vehicle | Home Assistant, TeslaMate |
| Cloud & Files | Immich, Nextcloud, Alist |
| Monitoring & Admin | Uptime Kuma, Portainer, 1Panel |

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/a350844866/jiaxu-portal.git
cd jiaxu-portal
npm install
```

### 2. Configure your services

```bash
cp src/config/services-data.example.ts src/config/services-data.ts
```

Edit `src/config/services-data.ts` and fill in your actual service URLs and internal health-check addresses.

Each service entry looks like:

```ts
{
  id: "my-service",
  name: "My Service",
  description: "Short description shown on the card",
  category: "monitoring-admin",   // see ServiceCategory type
  icon: "Server",                 // any lucide-react icon name
  url: "https://service.example.com",      // opened in browser (tab)
  healthUrl: "http://192.168.1.100:8080",  // pinged server-side
  tags: ["admin", "docker"],
  isOwn: true,   // optional: green accent, larger card
}
```

Available categories: `my-projects` · `media` · `iot-vehicle` · `cloud-files` · `monitoring-admin`

### 3. Run in development

```bash
npm run dev
# open http://localhost:3000
```

### 4. Deploy with Docker

```bash
docker compose up --build -d
# default port: 3200
```

Change the port in `docker-compose.yml` if needed.

## Configuration files

| File | Purpose |
|------|---------|
| `src/config/services-data.ts` | Your service list (**gitignored** — personal config) |
| `src/config/services-data.example.ts` | Template — copy and edit |
| `src/config/services.ts` | TypeScript type definitions |
| `src/config/categories-data.ts` | Category labels and icons |
| `docker-compose.yml` | Deployment config |

## How health checks work

Health checks run **server-side** inside the Docker container:

- Uses `healthUrl` (internal LAN IP) directly — faster, no DNS dependency
- Results cached for 30s via Next.js ISR (`revalidate = 30`)
- Client polls `/api/health` every 30s to refresh status dots without full reload

For services with self-signed TLS (e.g. Portainer on HTTPS), set `healthSkipTls: true`.

## Project structure

```
src/
  app/
    page.tsx                    # Main page — server component, fetches health on render
    api/health/route.ts         # GET /api/health — parallel ping all services
  components/
    layout/header.tsx           # Title + live clock
    dashboard/
      service-card.tsx          # Card with icon, name, desc, status dot, link
      service-grid.tsx          # Search filter + categorised grid (client)
      category-section.tsx      # Section header + card grid
      search-bar.tsx            # Real-time search input
      status-dot.tsx            # Animated green / red / grey dot
      status-summary.tsx        # "X / Y services online" strip
  config/
    services.ts                 # TypeScript types
    services-data.ts            # Your services (gitignored)
    services-data.example.ts    # Example / template
    categories-data.ts          # Category definitions
  lib/
    health-checker.ts           # Promise.allSettled parallel pings, 5s timeout
  hooks/
    use-service-filter.ts       # Client-side search filter hook
Dockerfile                      # Multi-stage standalone build (node:22-alpine)
docker-compose.yml              # Port 3200, share-network
```

## License

MIT
