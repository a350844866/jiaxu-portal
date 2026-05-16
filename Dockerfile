FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# mac-mini-collector 需要 ssh (拉 metrics 脚本) + iputils (ping 的 iputils 版本，
# BusyBox ping 输出格式不同，统一用 iputils 避免两套解析)
RUN apk add --no-cache openssh-client iputils

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# SSH master control socket 目录 (容器内可写 ephemeral, /data/portal-state 是 ro mount)
RUN mkdir -p /tmp/portal-ssh-mux && chown nextjs:nodejs /tmp/portal-ssh-mux

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
