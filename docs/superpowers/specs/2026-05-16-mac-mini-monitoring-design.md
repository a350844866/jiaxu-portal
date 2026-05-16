# Mac Mini 旁路由监控卡片 — 设计文档

> 2026-05-16  ·  起源：当晚 OpenClaw 死循环吃 CPU 导致全屋 Surge 旁路由抖动事件  ·  双视角设计（Claude + Codex 两轮 review）

## 1. 动机与问题

Mac Mini 192.168.31.2 是全屋 Surge 透明代理（旁路由），所有走代理的设备都过它 —— **family-network 单点故障**。

2026-05-16 晚 OpenClaw gateway 反复崩溃 + LaunchAgent 自动拉起死循环，CPU 50-94%，挤占转发中断，导致：
- 用户三国杀卡（电脑）+ 网页转圈 + 手机偶发丢包
- Claude 排查走了两次弯路（先误判境外代理、再误判 Wi-Fi 段），最后才定位 Mac Mini 自己卡

事后用户原话："**不然下次发生这种事情都不知道**" —— 需要主动告警，不只是事后排查。

**Mac Mini 当前在 jiaxu-portal 里完全黑盒**：`resource-rail.tsx` 只监控本机 jiaxu-server-home，surge-monitor 只看流量数据，都不覆盖 Mac Mini 系统资源。

## 2. 设计目标

Phase 1 MVP 必须满足：

1. **若此次事件重演，告警在卡死被用户察觉之前触发**
2. **如果 Claude 再次诊断同类问题，第一眼能直接锁定 Mac Mini，不走弯路**
3. **零侵入 Mac Mini**：不新增 LaunchAgent / HTTP endpoint
4. **fit 进现有 portal 卡片模式**：Next.js + shadcn/ui，复用 `resource-rail` 视觉风格

非目标（不在 Phase 1）：
- 历史持久化超 30 分钟（事后复盘）
- Mac Mini SPOF 根治（路由器 fallback 切回直连）
- Surge 内部状态深度可视化（surge-monitor 已有）

## 3. 架构

```
jiaxu-server-home (.66) → portal Docker 容器 (share-network bridge):
  collector daemon (Node, in-process, 15s tick)
    ├ ping .2 (Mac Mini) ← 注：容器内 ping，走 Docker NAT，非宿主路径
    ├ ping .1 (路由器对照) ← 同上
    └ SSH .2 → 跑死的 portal-macmini-metrics 脚本 (Mac Mini 上固定脚本，返回 JSON)
       ↓
  ring buffer (120 sample, ~30min) + alarm state (独立存储)
       ↓
  ├→ GET /api/mac-metrics (公网走 JWT, 内网 isInternalRequest 免 auth)
  │     ↓
  │   MacMiniRail 前端 (3s poll, 读缓存)
  └→ alarm engine → Telegram Bot API (Node fetch, retry, fail-safe)
```

**核心原则**：
- 后端单点采集 + 缓存，前端读缓存（防止 N 浏览器客户端各自触发 SSH）
- Daemon 在 UI 不打开时也持续采集 + 告警
- 采集点是容器内 (jiaxu-portal share-network bridge)，UI 必须标明

## 4. 组件

### 4.1 后端 collector daemon

**位置**：`src/lib/mac-mini-collector.ts`，portal 启动时引导

**职责**：
- 每 15s 跑一次采集 tick
- 数据落进程内 ring buffer（保留最近 **120 个样本 = 30 分钟**，API 只返回最新 30 给 UI）
- 告警状态（active / since / lastSent / lastRecovered）独立 Map 存储，不依赖 ring buffer 截断
- 命中告警规则时调 alarm engine 通知 TG

#### 4.1.1 采集 tick 内容

```
1. ping -c 3 -W 2 192.168.31.2  → avg, max, mdev, loss      (单步 timeout 3s)
2. ping -c 3 -W 2 192.168.31.1  → 同上（路由器对照）            (单步 timeout 3s)
3. SSH jiaxu@192.168.31.2 (复用 master) 跑固定脚本           (单步 timeout 5s)
     脚本内输出 JSON: { uptime_sec, load: [1,5,15], ncpu,
                       top_proc: [{pid, pcpu, pmem, comm, args}, ...] }
```

**全局 tick deadline = 10s**。所有子操作 `Promise.race` 配 AbortController。

**并发模型**：上次 tick 未完成时**跳过新 tick** + 记 `collector_lag += 1`，**不并发堆积**。

**Shell 命令一律 `execFile` / `spawn` + timeout，不用 shell 拼字符串**（防注入 + 防超时失控）。

#### 4.1.2 SSH 配置（修正 P0-1: ControlPath / known_hosts / accept-new）

容器内 ssh 调用参数（每次都带）：
```
ssh
  -i /data/portal-state/.ssh/id_ed25519_macmini
  -o UserKnownHostsFile=/data/portal-state/.ssh/known_hosts_macmini
  -o StrictHostKeyChecking=yes
  -o ControlMaster=auto
  -o ControlPath=/tmp/portal-ssh-mux/%C
  -o ControlPersist=10m
  -o ConnectTimeout=2
  -o ServerAliveInterval=2
  -o ServerAliveCountMax=1
  -o BatchMode=yes
  jiaxu@192.168.31.2
```

- **私钥 + known_hosts**：mount `/data/portal-state/.ssh:ro`
- **Control socket**：`/tmp/portal-ssh-mux/`（容器内 ephemeral，每次启动重建）
- `StrictHostKeyChecking=yes` + 提前 pin known_hosts（不用 `accept-new`，避免被中间人首次抢答）
- `BatchMode=yes` 禁止 ssh 弹密码/确认提示
- `ServerAliveCountMax=1` —— Mac Mini 卡死时 SSH 在 2 秒内 abort，不阻塞 tick

#### 4.1.3 Implementation prerequisite（实施前一次性手工准备）

1. **宿主机**：
   ```
   sudo mkdir -p /data/portal-state/.ssh
   ssh-keygen -t ed25519 -f /data/portal-state/.ssh/id_ed25519_macmini -C "portal@jiaxu-server-home" -N ""
   ssh-keyscan -t ed25519 192.168.31.2 > /data/portal-state/.ssh/known_hosts_macmini
   # 验证指纹（用户人工对一次 Mac Mini 上 `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`）
   chmod 600 /data/portal-state/.ssh/*
   ```

2. **Mac Mini 192.168.31.2 上**：

   建固定脚本 `/Users/jiaxu/bin/portal-macmini-metrics`（chmod 755）：
   ```bash
   #!/bin/bash
   # 不接受任何参数。输出 JSON 给 portal collector。
   set -u
   UPTIME=$(sysctl -n kern.boottime | awk -F'[,= ]' '{print $4}')
   NOW=$(date +%s)
   NCPU=$(sysctl -n hw.ncpu)
   read L1 L5 L15 <<< "$(sysctl -n vm.loadavg | tr -d '{}')"
   echo "{"
   echo "  \"uptime_sec\": $((NOW - UPTIME)),"
   echo "  \"ncpu\": $NCPU,"
   echo "  \"load\": [$L1, $L5, $L15],"
   echo "  \"top_proc\": ["
   ps -Ao pid,pcpu,pmem,comm,args -r | awk 'NR>1 && NR<=6 {
       cmd=""; for(i=5;i<=NF;i++) cmd=cmd" "$i; gsub(/"/,"\\\"",cmd);
       printf "%s    {\"pid\":%d,\"pcpu\":%.1f,\"pmem\":%.1f,\"comm\":\"%s\",\"args\":\"%s\"}", (NR==2?"":",\n"), $1,$2,$3,$4,substr(cmd,2,200)
   }'
   echo ""
   echo "  ]"
   echo "}"
   ```

   `authorized_keys` 追加专用条目（**不用 `restrict` 关键字**，会隐式禁 port forwarding —— 教训详 vault [[全局网络架构]] §备选 SSH 路径）：
   ```
   command="/Users/jiaxu/bin/portal-macmini-metrics",no-agent-forwarding,no-X11-forwarding,no-pty,no-user-rc,no-port-forwarding <portal pubkey>
   ```

   即使私钥泄漏，攻击者也只能跑这一个脚本拿监控 JSON，**无法拿 shell / forwarding / agent**。

3. **portal Dockerfile**（runner 缺 ssh / 选 ping 实现 — P0-2）：

   `node:22-alpine` runner 加：
   ```dockerfile
   RUN apk add --no-cache openssh-client iputils
   ```
   - `openssh-client`：装 ssh
   - `iputils`：装 iputils 版本的 ping（BusyBox ping 输出格式不同，避免解析两套）

4. **docker-compose.yml**：
   ```yaml
   volumes:
     - /data/portal-state/.ssh:/data/portal-state/.ssh:ro
   environment:
     - PORTAL_TG_BOT_TOKEN=${PORTAL_TG_BOT_TOKEN}
     - PORTAL_TG_CHAT_ID=${PORTAL_TG_CHAT_ID}
     - MAC_MINI_HOST=192.168.31.2
     - ROUTER_HOST=192.168.31.1
   ```

### 4.2 GET /api/mac-metrics

**位置**：`src/app/api/mac-metrics/route.ts`

**Auth（P0-5）**：复用 portal 现有 middleware：
- 公网请求（无 internal Host / XFF）→ JWT/TOTP 拦截（同 portal 其他敏感 API）
- 内网请求 `isInternalRequest()=true` → 免 auth
- **默认不返回完整 `args`**（只返回 `comm`）；带 query `?detail=1` 且 auth 通过才返回 args（避免无意泄漏到公网未登录态）

**返回**：最新 tick + 30 样本 mdev/load 序列 + collector 健康指标（P1-8）

```json
{
  "ts": "2026-05-16T20:30:15+08:00",
  "sample_age_ms": 4231,
  "ping_macmini": { "avg": 0.31, "max": 0.52, "mdev": 0.08, "loss": 0 },
  "ping_router":  { "avg": 0.70, "max": 0.81, "mdev": 0.04, "loss": 0 },
  "ssh_ok": true,
  "mac_uptime_sec": 561234,
  "ncpu": 8,
  "load":  { "1": 1.2, "5": 1.5, "15": 1.8 },
  "top_proc": [
    { "pid": 404, "pcpu": 7.8, "pmem": 6.8, "comm": "Surge" }
  ],
  "history": { "mdev": [...], "load1": [...] },
  "alarms_active": [],
  "collector": {
    "started_at": "...",
    "last_tick_at": "...",
    "last_success_at": "...",
    "tick_age_ms": 4231,
    "consecutive_failures": 0,
    "collector_lag": 0,
    "last_notify_error": null,
    "pending_notifications": 0,
    "capture_point": "jiaxu-portal-container@share-network"
  }
}
```

### 4.3 MacMiniRail UI 组件

**位置**：`src/components/dashboard/mac-mini-rail.tsx`

**布局**：单 Rail，复用 `resource-rail.tsx` 30-bar sparkline + 数字

```
┌─ Mac Mini 旁路由 [container view] ────── ● ─┐
│ ping mdev   ▁▁▁▂▂▁▁▂▃▂▁▁ 0.08 ms / max 0.5 │
│ load 1      ▁▁▂▂▃▂▂▁▁▁▁▁ 1.2 / ncpu 8      │
│ vs router   mdev 0.04ms loss 0 / ssh ok    │
│ ▼ top: Surge 7.8% / WindowServer 5.1%  ... │
│ collector tick age 4s / lag 0 ▪            │
└────────────────────────────────────────────┘
```

- 角标 `[container view]`：明示采集点是 portal 容器内（解释 ping 走 Docker NAT — P1-9）
- 底部 `collector tick age` 让用户一眼看 collector 死活（tick_age > 30s 标红 — P1-8 / P2-3）

**状态点颜色**：
- 🟢 全绿：ping mdev < 5ms ∧ load < ncpu×0.5 ∧ ssh ok ∧ tick_age < 30s
- 🟡 黄：任一接近阈值（mdev 5-20ms / load ncpu×0.5-0.8 / tick_age 30-60s）
- 🔴 红：任一告警活跃 / collector 死了 / SSH 断开

**挂载点**：`src/app/page.tsx`，挂在 `<TokenCard />` 之后、`<ServiceGrid />` 之前

### 4.4 告警引擎

**位置**：`src/lib/mac-mini-alarms.ts`

#### 4.4.1 规则集（5 条 — 新增 R0）

| ID | 条件 | 优先级 | TG 内容 |
|---|---|---|---|
| `R0_mac_unreachable` ⚡ | `ssh_ok=false` **或** ping Mac Mini loss=100% 持续 2-3 tick (≈30-45s)，且 router ping 正常 | 最高 | "Mac Mini 失联（SSH/ping 全断），路由器对照正常" |
| `R1_lan_jitter` | ping Mac Mini mdev > 20ms 或 loss 5-99%，且 router mdev < 5ms ∧ loss=0，持续 3 tick (≈45s) | 高 | "旁路由 LAN 抖动" + 当前 jitter |
| `R2_load_high` | load 1 > `ncpu × 0.8`（不写死，**采 sysctl hw.ncpu** — P2-2），持续 12 tick (≈3min) | 中 | 附 top 3 进程 |
| `R3_proc_cpu` | 单进程 CPU > 80%，持续 8 tick (≈2min) | 中 | 进程名 + PID + **args**（完整 cmdline — P2-1） |
| `R4_pid_churn` ⭐ | 同一 `comm` 在 5min 内出现 ≥3 个不同 PID **且**至少 2 个样本中该 comm pcpu > 30%（**P1-4 误伤补丁**） | 高 | "疑似崩溃重启循环" + comm + N 个 PID |

⭐ R4 用"PID churn + 高 CPU"双重门槛排除 zsh/sh/GoogleUpdater/mdworker 这类正常短命进程

#### 4.4.2 静默 / 抑制规则（P1-3 / P1-5 fail-safe）

- **router 失败时抑制**：ping 路由器 loss > 0 或 mdev > 5ms → R1 不触发，但触发 `collector_network_degraded` 状态（UI 黄，**TG 不刷屏**只在状态首次进入时推一次 "对照路由器也异常，本次抖动不能归因 Mac Mini"）
- **R0 活跃时抑制 R1/R2/R3/R4**：Mac 都失联了，下游规则没数据来源
- **R4 reboot 静默**：本 tick `mac_uptime_sec < 300` 或 `mac_uptime_sec < 上一样本` → 清空 R4 PID history + 静默 5min
- **R4 在 SSH 失败时不更新 PID 集**：`ssh_ok=false` 的 tick 不进入 R4 计数器
- **warmup 静默**：collector 启动后前 60s 不触发任何告警

#### 4.4.3 告警合并（P1-7 具体化）

每 tick 跑：

1. 计算所有 state transition（`inactive→active` / `active→recovered`）
2. **同 tick 多个 inactive→active** → 按优先级 R0>R1>R2>R3>R4 合并 1 条 TG，**标题用最高优先级规则**，正文列所有命中规则 + 关键指标 + top 3 进程
3. **同 tick 多个 recovered** → 合 1 条"已恢复"
4. active 和 recovery **不混**在一条
5. **每条规则 cooldown = 30min**：活跃期间不重推，但 inactive→active 不受 cooldown 影响（状态变化总能推）
6. TG fetch 失败 → 进 `pending_notifications` 队列，下一 tick 重试 1 次，仍失败只 UI 标红 + `last_notify_error`，**不无限刷**

### 4.5 TG 通知

**选定**：portal Node 后端直接 `fetch('https://api.telegram.org/bot${TOKEN}/sendMessage')`（Node 18+ 内置 fetch，零新依赖）

**实施细节**：
- 超时 5s，失败重试最多 2 次（间隔 2s），全失败进 pending queue
- **不阻塞 collector tick**：TG fetch 在独立 microtask，超时强制 abort
- 失败计数进 `collector.last_notify_error`，UI 可见

**env 用前缀**：`PORTAL_TG_BOT_TOKEN` / `PORTAL_TG_CHAT_ID`，**禁用裸 `TELEGRAM_BOT_TOKEN`**（已知坑：`/etc/environment` 全局会静默覆盖容器 `.env`，MT4/MT5 都踩过 — vault memory `reference_docker_compose_env_precedence`）

## 5. 数据流

```
每 15s collector tick (deadline 10s):
  并行: ping .2 / ping .1 / SSH .2 跑 portal-macmini-metrics
    → 写 ring buffer (120 sample, ~30min 历史)
    → 跑 alarm engine (state transition 计算)
      → 触发 → Node fetch TG (timeout 5s, retry 2x, pending queue)
    → 缓存"最新 tick 结果" + "30 样本序列"

前端 3s:
  浏览器 → GET /api/mac-metrics (auth 由 portal middleware) → 返回缓存

异常时:
  inactive→active → 同 tick 合 1 条 TG (按优先级)
  active→recovered → 同 tick 合 1 条 "已恢复"
  TG 失败 → pending queue + UI 标红
```

## 6. 测试策略

**单元测试**：
- `mac-mini-alarms.ts` 规则函数 pure function，喂构造数据集验证触发/不触发
- R4 误伤排除：喂 zsh PID churn 但 pcpu < 30% → 不触发
- ring buffer 入队 / 截断到 120 / 序列化最后 30
- 告警合并：同 tick 多规则触发 → 1 条 TG，按优先级排序

**集成测试**：
- mock SSH 失败 → `ssh_ok=false` + 持续 3 tick → R0 触发
- mock SSH 阻塞超时（永不返回）→ tick deadline 10s 内强制结束 + `collector_lag += 1`
- mock router ping 异常 + Mac Mini ping 异常 → R1 抑制，`collector_network_degraded` 状态进入
- mock TG fetch 502 → pending queue + retry + UI 标红

**手工验证（修正 P2-4，更严谨）**：
- Mac Mini 上 `yes > /dev/null` 60s → R3 触发，TG 带 args
- 1 秒 kill 一次的 bash 重启循环 **且 pcpu > 30%** → R4 触发
- 同上但 pcpu < 30%（如纯 sleep 循环）→ R4 **不触发**（误伤防护验证）
- 在 Mac Mini 上 `sudo launchctl unload com.openssh.sshd` 但保留 ping 通 → **R0 触发**（SSH 死 ≠ ping 死）
- 拔 Mac Mini 网线 → R0 + R1 同时触发，合 1 条 TG
- 路由器重启（同时影响 Mac Mini 和对照）→ R1 抑制，`collector_network_degraded` 状态
- 重启 Mac Mini → R4 静默 5min（reboot 后 PID 全重置不误报）

## 7. 实施层次

**MVP（这次做完）**：4.1 + 4.2 + 4.3 + 4.4 + 4.5 全部上，含所有静默/抑制规则和告警合并

**Phase 2（不在 spec 范围）**：
- collector 拆 sidecar 容器（彻底解耦 portal OOM / CPU spike）
- 告警去抖增强（夜间静默 / 节假日规则）
- Mac Mini SPOF fallback：路由器 fallback 切回直连网关
- 历史持久化扩展（SQLite，30min → 24h+）
- 多 host 泛化（小米路由器 / qB / Plex）

## 8. 风险与盲点

- **进程名黑名单陷阱**：不能写死"OpenClaw 在跑就告警"。R3/R4 按行为特征判，进程名只作 TG 上下文
- **采集本身变负载源**：必须后端单点 + 缓存，前端只读（架构强制）
- **告警风暴**：OpenClaw 死循环同时命中 R2/R3/R4 —— alarm engine 已实现按优先级合并 1 条 TG
- **Mac Mini 重启误报**：`mac_uptime_sec < 300` 静默 R4，且 uptime 变小判定 reboot 清 PID history
- **In-process daemon 耦合风险**：portal OOM/CPU spike 时 collector 跟着挂 = 监控本身消失。MVP 接受，靠 `/api/mac-metrics` 的 `tick_age_ms` 让用户/外部探针看出"collector 死了"。Phase 2 sidecar 解决
- **容器内 ping ≠ 宿主 ping**：Docker NAT 抖动可能误判成 Mac 问题。UI 标 `[container view]`，部署后用宿主对照验证一次。Phase 2 可加宿主 host-net ping sidecar
- **SPOF 监控只能早发现不能根治**：路由器 fallback 是 Phase 2 议题

## 9. 双轮 review 决策追溯

- **第一轮 codex review**（thread `019e30c1-8b4d-7cb1-a474-521ee059bab2`）：贡献方案 1 推荐 / 4 规则雏形 / R4 PID churn 概念 / 路由器对照 / 关键盲点（进程名陷阱、告警风暴、采集变负载、重启误报、SPOF 不能根治）
- **第二轮 codex adversarial review**（thread `019e30d6-cb20-7da3-99d8-685438a521b9`）：找出 5 P0 + 9 P1 + 5 P2，本 spec 修订全部纳入
  - P0：ControlPath 缺失 / runner 缺 ssh+iputils / authorized_keys command 空白 / collector 阻塞模型 / API auth 缺失
  - P1：架构图矛盾 / 新增 R0 / fail-safe 状态机 / R4 误伤补丁 / reboot 扩静默 / ring 改 120 / 合并具体化 / collector health 字段 / 容器 ping 路径标注
  - P2：ps args / hw.ncpu / sample_age_ms / 手工验证用例精确化

## 10. 参考

- vault: [[Mac Mini]] §OpenClaw Mac 版 / §LaunchAgents（卸载后剩余）
- vault: [[jiaxu-portal]] §Token Usage Card（同类卡片实现模板）
- vault: [[全局网络架构]]（旁路由拓扑 / 备选 SSH 路径教训：不用 `restrict`）
- vault: [[surge-monitor]]（既有 Mac Mini 流量监控，与本设计互补不重叠）
- 事件 commit: `409e222` refactor 2026-05-16 Mac Mini: 卸载 OpenClaw activeness 实例
- vault memory: `reference_docker_compose_env_precedence`（env 前缀防全局覆盖）
- vault memory: `feedback_codex_adversarial_review_security`（auth/network/token 改动主动路由 adversarial review）
