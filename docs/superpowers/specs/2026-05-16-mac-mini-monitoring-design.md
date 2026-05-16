# Mac Mini 旁路由监控卡片 — 设计文档

> 2026-05-16  ·  起源：当晚 OpenClaw 死循环吃 CPU 导致全屋 Surge 旁路由抖动事件  ·  双视角设计（Claude + Codex）

## 1. 动机与问题

Mac Mini 192.168.31.2 是全屋 Surge 透明代理（旁路由），所有走代理的设备都过它 —— **family-network 单点故障**。

2026-05-16 晚 OpenClaw gateway 反复崩溃 + LaunchAgent 自动拉起死循环，CPU 50-94%，挤占转发中断，导致：
- 用户三国杀卡（电脑）+ 网页转圈 + 手机偶发丢包
- Claude 排查走了两次弯路（先误判境外代理、再误判 Wi-Fi 段），最后才定位 Mac Mini 自己卡

事后用户原话：**"不然下次发生这种事情都不知道"** —— 需要主动告警，不只是事后排查。

**Mac Mini 当前在 jiaxu-portal 里完全黑盒**：`resource-rail.tsx` 只监控本机 jiaxu-server-home，surge-monitor 只看流量数据（请求/域名/可疑域名），都不覆盖 Mac Mini 系统资源。

## 2. 设计目标

Phase 1 MVP 必须满足：

1. **若此次事件重演，告警在卡死被用户察觉之前触发**
2. **如果 Claude 再次诊断同类问题，第一眼能直接锁定 Mac Mini，不走弯路**
3. **零侵入 Mac Mini**：不新增 LaunchAgent / HTTP endpoint（用户刚被 OpenClaw 创伤）
4. **fit 进现有 portal 卡片模式**：Next.js + shadcn/ui，复用 `resource-rail` 视觉风格

非目标（不在 Phase 1）：
- 历史持久化超 10 分钟（事后复盘）
- Mac Mini SPOF 根治（路由器 fallback 切回直连）
- Surge 内部状态深度可视化（节点切换、流量明细 —— surge-monitor 已有）

## 3. 架构

```
┌──────────────────────────────────────────────────────────────┐
│ jiaxu-server-home (192.168.31.66)                            │
│                                                              │
│   ┌────────────────────────────────────────┐                 │
│   │ jiaxu-portal Docker container          │                 │
│   │                                        │                 │
│   │  ┌─────────────────────────────┐       │                 │
│   │  │ mac-mini-collector daemon   │       │                 │
│   │  │ (Node, in-process, 15s tick)│       │                 │
│   │  │                             │       │                 │
│   │  │  - ping .2 + ping .1 对照   │       │                 │
│   │  │  - SSH .2 → uptime + ps -r  │       │  SSH (master)   │
│   │  │  - alarm engine             │ ─────────────→ Mac Mini │
│   │  │  - in-mem ring buffer       │       │   (192.168.31.2)│
│   │  └──────────┬──────────────────┘       │                 │
│   │             │                          │                 │
│   │  ┌──────────▼──────────────────┐       │                 │
│   │  │ GET /api/mac-metrics        │       │                 │
│   │  │ (reads ring buffer cache)   │       │                 │
│   │  └──────────┬──────────────────┘       │                 │
│   │             │                          │                 │
│   │  ┌──────────▼──────────────────┐       │                 │
│   │  │ MacMiniRail (client)        │       │                 │
│   │  │ 3s polling                  │       │                 │
│   │  └─────────────────────────────┘       │                 │
│   │                                        │                 │
│   │  ┌─────────────────────────────┐       │                 │
│   │  │ alarm engine → TG bot       │ ─────────→ Telegram     │
│   │  │ (via tg-notify.sh in mount) │       │                 │
│   │  └─────────────────────────────┘       │                 │
│   └────────────────────────────────────────┘                 │
└──────────────────────────────────────────────────────────────┘
```

**核心原则**：
- 后端单点采集 + 缓存，前端读缓存（防止 N 个浏览器客户端各自触发 SSH 把监控变成负载源）
- 采集层是 daemon，UI 不存在或不被打开时也照常采集 + 告警

## 4. 组件

### 4.1 后端 collector daemon

**位置**：`src/lib/mac-mini-collector.ts`（Node module，portal 启动时引导）

**职责**：
- 每 15s 跑一次采集 tick
- 数据落进程内 ring buffer（保留最近 40 个样本 = 10 分钟）
- 命中告警规则时调 alarm engine 通知 TG

**采集 tick 内容**：
```
1. ping -c 3 -W 2 192.168.31.2  → avg, max, mdev, loss
2. ping -c 3 -W 2 192.168.31.1  → 同上（路由器对照）
3. SSH jiaxu@192.168.31.2 (master connection 复用):
     uptime → load 1/5/15
     ps -Ao pid,pcpu,pmem,comm -r | head 6 → top 5 进程
```

**SSH 复用**：用 `ControlMaster=auto / ControlPersist=10m` 起 SSH master，后续采集走同连接，避免每 15s 完整握手。

**SSH 凭证**：portal 容器内 `/data/portal-state/.ssh/id_ed25519_macmini`（只读 mount），私钥仅本机 portal 容器可见。**不用密码登录**（避免 sshpass 在容器里）。

**Implementation prerequisite**（实施前一次性手工准备）：
1. 宿主机 `/data/portal-state/.ssh/` 下 `ssh-keygen -t ed25519 -f id_ed25519_macmini -C "portal@jiaxu-server-home" -N ""`
2. 把生成的公钥追加到 Mac Mini `jiaxu@192.168.31.2:~/.ssh/authorized_keys`（带 options：`command="..."` 限制成只能跑指定白名单命令 + `no-pty,no-X11-forwarding`，详见 [[全局网络架构]] §备选 SSH 路径教训 — 不用 `restrict` 关键字）
3. `docker-compose.yml` 加 `/data/portal-state/.ssh:/data/portal-state/.ssh:ro` mount
4. 容器内 ssh wrapper 用 `-o StrictHostKeyChecking=accept-new -o ControlMaster=auto -o ControlPersist=10m`

### 4.2 GET /api/mac-metrics

**位置**：`src/app/api/mac-metrics/route.ts`

**返回**：collector 最近一次 tick 结果 + 最近 30 个样本的 mdev / load 序列

```json
{
  "ts": "2026-05-16T20:30:15+08:00",
  "ping_macmini": { "avg": 0.31, "max": 0.52, "mdev": 0.08, "loss": 0 },
  "ping_router":  { "avg": 0.70, "max": 0.81, "mdev": 0.04, "loss": 0 },
  "ssh_ok": true,
  "load":  { "1": 1.2, "5": 1.5, "15": 1.8 },
  "top_proc": [
    { "pid": 404, "pcpu": 7.8, "pmem": 6.8, "comm": "Surge" },
    { "pid": 168, "pcpu": 5.1, "pmem": 1.1, "comm": "WindowServer" },
    ...
  ],
  "history": {
    "mdev": [0.08, 0.10, 0.09, ...],
    "load1": [1.2, 1.3, ...]
  },
  "alarms_active": []   // 当前活跃告警
}
```

### 4.3 MacMiniRail UI 组件

**位置**：`src/components/dashboard/mac-mini-rail.tsx`

**布局**：单 Rail，复用 `resource-rail.tsx` 视觉风格（30-bar sparkline + 数字）

```
┌─ Mac Mini 旁路由 ──────────────────────── ● ─┐
│ ping mdev   ▁▁▁▂▂▁▁▂▃▂▁▁ 0.08 ms / max 0.5 │
│ load 1      ▁▁▂▂▃▂▂▁▁▁▁▁ 1.2 (核数 × 0.15)│
│ vs router   mdev 0.04ms loss 0 / ssh ok    │
│ ▼ top: Surge 7.8% / WindowServer 5.1%  ... │
└────────────────────────────────────────────┘
```

**状态点颜色**：
- 🟢 全绿：ping mdev < 5ms ∧ load < 核数×0.5 ∧ ssh ok
- 🟡 黄：任一指标"接近阈值"（mdev 5-20ms / load 核数×0.5-0.8）
- 🔴 红：任一告警规则当前活跃

**挂载点**：`src/app/page.tsx`，挂在 `<TokenCard />` 之后、`<ServiceGrid />` 之前（与本机 `resource-rail` 同一栏视觉对称）。

### 4.4 告警引擎

**位置**：`src/lib/mac-mini-alarms.ts`

**4 条规则**：

| ID | 条件 | 触发动作 |
|---|---|---|
| `R1_lan_jitter` | ping Mac Mini mdev > 20ms **或** loss > 5%，且 ping 路由器 mdev < 5ms ∧ loss=0，**持续 3 次 tick (≈45s)** | TG: "旁路由 LAN 异常，路由器对照正常 → Mac Mini 自身问题" |
| `R2_load_high` | load 1 > 核数 × 0.8（Mac Mini M2 是 8 核 → 阈值 6.4），**持续 12 次 tick (≈3min)** | TG: 附上 top 3 进程 |
| `R3_proc_cpu` | 单进程 CPU > 80%，**持续 8 次 tick (≈2min)** | TG: 进程名 + PID + cmdline |
| `R4_pid_churn` ⭐ | 同一 `comm` 在 5min 内出现 ≥3 个不同 PID（崩溃-重启循环特征） | TG: "疑似崩溃重启循环：comm X，5min 内 N 个 PID" |

⭐ R4 是这次 OpenClaw 事件的最强信号 —— 进程名不重要，只要"反复换 PID"就是病态。

**告警纪律**：
- 每条规则进入"活跃"状态发一次 TG；恢复时发一次"已恢复"
- 同一规则活跃期间不重复推（避免刷屏）
- 启动后前 60s 不触发告警（warmup，避免空 buffer 误报）

### 4.5 TG 通知

**选定：portal Node 后端直接 fetch `https://api.telegram.org/bot${TOKEN}/sendMessage`**（不挂载 `tg-notify.sh` 减少跨进程依赖；fetch 是 Node 18+ 内置，零新依赖）。

**env 变量必须用前缀** `PORTAL_TG_BOT_TOKEN` / `PORTAL_TG_CHAT_ID`，**禁用裸 `TELEGRAM_BOT_TOKEN`**（已知坑：`/etc/environment` 全局 `TELEGRAM_BOT_TOKEN=...` 会被 docker-compose `${VAR:-}` 静默覆盖容器 `.env`，详见 vault memory `reference_docker_compose_env_precedence`；MT4/MT5 都踩过）。

token 与 chat_id 落 portal 项目根 `.env`（gitignore），通过 `docker-compose.yml` 透传到容器。

## 5. 数据流

```
每 15s:
  collector tick
    → 并行 (ping .2 / ping .1 / ssh 拉 uptime+ps)
    → 写 ring buffer (40 sample, ~10 min 历史)
    → 跑 alarm engine
      → 触发 → tg-notify.sh
    → 缓存"最新 tick 结果" + "30 样本序列"

每 3s (前端):
  浏览器 → GET /api/mac-metrics → 返回缓存（不触发新采集）

异常时:
  alarm 进入 active → TG 一条
  alarm 退出 active → TG 一条"已恢复"
```

## 6. 测试策略

**单元测试**：
- `mac-mini-alarms.ts` 规则函数 pure function，喂构造数据集验证触发/不触发
- ring buffer 入队/截断/序列化

**集成测试**：
- mock SSH 失败 → collector 上报 `ssh_ok: false`，UI 显示 ⚠️
- mock 路由器 ping 异常 + Mac Mini ping 正常 → R1 不触发（路由器问题不算 Mac Mini 异常）

**手工验证**：
- 部署后人为在 Mac Mini 起一个 `yes > /dev/null` 跑 60s → R3 应触发
- 起一个 1 秒 kill 一次的 bash 重启循环 → R4 应触发
- 关 Wi-Fi → R1 不触发（不影响 LAN）；拔 Mac Mini 网线 → R1 触发

## 7. 实施层次

**MVP（这次做完）**：4.1 + 4.2 + 4.3 + 4.4 + 4.5 全部上。

**Phase 2（不在 spec 范围）**：
- 告警去抖增强（夜间静默 / 节假日规则）
- Mac Mini SPOF fallback：路由器 fallback 切回直连网关
- 历史持久化扩展（SQLite，从 10min 扩到 24h+）
- 把这套架构泛化成多 host（小米路由器、qB、Plex 等也接入）

## 8. 风险与盲点

- **进程名黑名单陷阱**：不能写"OpenClaw 在跑就告警"。下次罪魁可能是 GoogleUpdater / Chrome / python。R3/R4 规则按"行为特征"判，进程名只作为 TG 上下文。
- **采集本身变成负载源**：必须后端单点采集 + 缓存，前端只读。已在架构里强制。
- **Mac Mini 卡死到 SSH 不响应时**：collector ssh 超时 → ring buffer 写入 `ssh_ok: false`。这本身就是告警信号（"Mac Mini 失联"），UI 显示红点 + TG 推 R1（ping 也会同步异常）。
- **告警风暴**：R1 R2 R3 R4 可能同时触发（OpenClaw 死循环就同时命中 R2/R3/R4），需聚合一条 TG 而非 4 条。alarm engine 引入"同一 tick 多规则触发 → 合并 1 条"。
- **重启 Mac Mini 误报**：Mac Mini 重启时所有 PID 重置，R4 容易误触发。规则补丁：`uptime < 5min` 时 R4 静默。
- **SPOF 监控只能早发现，不能根治**：长期方向是路由器具备 Mac Mini 失效 fallback 能力。Phase 2 议题。

## 9. 参考

- vault: [[Mac Mini]] §OpenClaw Mac 版 / §LaunchAgents（卸载后剩余）
- vault: [[jiaxu-portal]] §Token Usage Card（同类卡片实现模板）
- vault: [[全局网络架构]]（旁路由拓扑）
- vault: [[surge-monitor]]（既有 Mac Mini 流量监控，与本设计互补不重叠）
- 事件 commit: `409e222` refactor 2026-05-16 Mac Mini: 卸载 OpenClaw activeness 实例
- 设计协作：Claude（主）+ Codex high effort（review，2026-05-16 thread `019e30c1-8b4d-7cb1-a474-521ee059bab2`）
