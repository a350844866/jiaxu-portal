#!/bin/bash
# 家服侧部署 cpclaude 用量链路(幂等)。在 portal 仓库根执行:
#   bash scripts/glm-usage/deploy-host.sh
# 停用: sudo systemctl disable --now glm-usage-snapshot.timer
#
# 权限分层: 以 root 跑的 aggregate 装进 root 所有的 /usr/local/lib/glm-usage、账本在 /var/lib/glm-usage,
# jiaxu 改不到 root 会执行的代码; 以 jiaxu 跑的 collect-vm.sh 与要发给 MBP 的抽取脚本/安装器放 /data/claude-usage/glm-usage。
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
D=/data/claude-usage/glm-usage
R=/data/claude-usage/remote-glm

install -d -m 755 "$D" "$R"
install -m 755 "$SRC/glm_usage_extract.py" "$SRC/collect-vm.sh" "$SRC/mbp-install.sh" "$D/"
sudo install -d -o root -g root -m 755 /usr/local/lib/glm-usage /var/lib/glm-usage /var/lib/glm-usage/ledger /etc/glm-usage
# /etc/glm-usage/aliases.json = 网关通道别名 {"aliases": {回包模型名: 价目 key}}: 属网关侧信息, 不进本(公开)仓库。
# 这里只建目录; 文件由运维手工放(root:root 644), 已有的不动。缺文件 = 无额外别名, 相关模型在卡片上标 * 未定价。
sudo install -o root -g root -m 644 "$SRC/glm_usage_aggregate.py" /usr/local/lib/glm-usage/
sudo install -o root -g root -m 644 "$SRC/systemd/glm-usage-snapshot.service" "$SRC/systemd/glm-usage-snapshot.timer" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now glm-usage-snapshot.timer
sudo systemctl start glm-usage-snapshot.service
systemctl --no-pager --lines=5 status glm-usage-snapshot.service || true
