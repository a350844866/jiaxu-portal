import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  output: "standalone",
  skipTrailingSlashRedirect: true,
  serverExternalPackages: ["better-sqlite3"],
}

export default nextConfig
