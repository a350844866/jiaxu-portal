#!/bin/bash
# 从家服云脉 VM 拉 cpclaude 用量帧(纯数字)。抽取脚本经 ssh stdin 送进 VM 内执行,
# 会话 jsonl 不出 VM; 回来的只有 message.id / 时间 / 模型 / 项目目录名 / token 数。
# VM 未开机或 ssh 失败 → 保留上一帧(aggregate 按帧内 generated_at 标「未同步」), 不用空帧覆盖。
set -uo pipefail

D=/data/claude-usage/glm-usage
OUT_DIR=/data/claude-usage/remote-glm
HOST=yunmai-vm

TMP=$(mktemp "$OUT_DIR/.$HOST.json.XXXXXX") || exit 1
trap 'rm -f "$TMP"' EXIT

if ! timeout 90 ssh -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=10 "$HOST" \
     "python3 - --host $HOST" < "$D/glm_usage_extract.py" > "$TMP"; then
  echo "collect-vm: ssh/抽取失败(VM 未开机?), 保留上一帧" >&2
  exit 1
fi

if ! python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if d.get("kind")=="glm-usage-host" and d.get("host")==sys.argv[2] else 1)' "$TMP" "$HOST"; then
  echo "collect-vm: VM 帧校验失败, 保留上一帧" >&2
  exit 1
fi

chmod 644 "$TMP"
mv -f "$TMP" "$OUT_DIR/$HOST.json"
trap - EXIT
