#!/bin/bash
# MBP 一次性安装: cpclaude 用量(纯数字)定时同步到家服。在 MBP 终端执行:
#   ssh home-server 'cat /data/claude-usage/glm-usage/mbp-install.sh' | bash
#
# 传输复用 claude-usage-sync 同一套(launchd 10min + rsync 走 ssh home-server 隧道), 但另起独立
# launchd 标签, 不改原 ~/.claude/claude-usage-sync.sh。与 Claude 那路的区别: 这里先在 MBP 本地
# 抽取, 离开 MBP 的只有 message.id / 时间 / 模型 / 项目目录名 / token 数, 会话 jsonl 不出机。
# 卸载: launchctl bootout gui/$(id -u)/work.liulin.glm-usage-sync; rm -rf ~/.claude/glm-usage ~/Library/LaunchAgents/work.liulin.glm-usage-sync.plist
set -euo pipefail

[ "$(uname)" = Darwin ] || { echo "只在 MBP(macOS) 上执行" >&2; exit 1; }
D="$HOME/.claude/glm-usage"
LABEL=work.liulin.glm-usage-sync
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PY="$(command -v python3 || true)"
[ -n "$PY" ] || { echo "缺 python3" >&2; exit 1; }
[ -d "$HOME/.claude-glm-config/projects" ] || echo "注意: 没找到 ~/.claude-glm-config/projects, 帧里会是 0 条" >&2

mkdir -p "$D" "$HOME/Library/LaunchAgents"
scp -q -o BatchMode=yes home-server:/data/claude-usage/glm-usage/glm_usage_extract.py "$D/glm_usage_extract.py"

cat > "$D/sync.sh" <<EOF
#!/bin/bash
# launchd($LABEL) 每 10 分钟: 本地抽数字 → rsync 到家服。公司断网时 rsync 失败, 下个 tick 重试。
set -uo pipefail
D="\$HOME/.claude/glm-usage"
LOG="\$D/sync.log"
OUT="\$D/glm-usage-mbp.json"
if ! "$PY" "\$D/glm_usage_extract.py" --host mbp --config-dir "\$HOME/.claude-glm-config" --out "\$OUT" 2>>"\$LOG"; then
  echo "[\$(date '+%F %T')] extract failed" >>"\$LOG"; exit 1
fi
if ! rsync -az --timeout=60 -e "ssh -o BatchMode=yes -o ConnectTimeout=15" "\$OUT" home-server:/data/claude-usage/remote-glm/mbp.json 2>>"\$LOG"; then
  echo "[\$(date '+%F %T')] rsync failed" >>"\$LOG"
fi
if [ "\$(stat -f%z "\$LOG" 2>/dev/null || echo 0)" -gt 200000 ]; then
  tail -n 200 "\$LOG" >"\$LOG.trim" && mv -f "\$LOG.trim" "\$LOG"
fi
exit 0
EOF
chmod 755 "$D/sync.sh"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$D/sync.sh</string></array>
  <key>StartInterval</key><integer>600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardErrorPath</key><string>$D/launchd.err</string>
</dict>
</plist>
EOF

# 首跑: 打一行对账摘要(纯数字), 立刻推一次
"$PY" "$D/glm_usage_extract.py" --host mbp --config-dir "$HOME/.claude-glm-config" --out "$D/glm-usage-mbp.json" --summary
rsync -az --timeout=60 -e "ssh -o BatchMode=yes -o ConnectTimeout=15" "$D/glm-usage-mbp.json" home-server:/data/claude-usage/remote-glm/mbp.json \
  && echo "已推到家服 remote-glm/mbp.json" || echo "首推失败(隧道不通?), launchd 会每 10 分钟重试" >&2

# bootout 返回时服务未必已卸干净, 紧接 bootstrap 常报 "Input/output error": 等它消失再装, 失败重试一次
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
for _ in 1 2 3 4 5; do launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || break; sleep 1; done
launchctl bootstrap "gui/$(id -u)" "$PLIST" || { sleep 2; launchctl bootstrap "gui/$(id -u)" "$PLIST"; }
echo "launchd $LABEL 已加载(600s + RunAtLoad)"
