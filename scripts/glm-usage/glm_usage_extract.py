#!/usr/bin/env python3
"""
glm_usage_extract — 在来源机本地把 cpclaude(部门 GLM)会话 jsonl 压成「纯数字」帧.

离开来源机的只有: message.id / timestamp / message.model / 项目目录名 / 四项 token.
会话文本、prompt、工具结果、公司代码一律不输出、不写日志 (解析整行只为取 usage, 用完即丢).

去重: 同一条回复在流式分块时以同一 message.id 重复落盘多行 → 按 id 只留 token 合计最大的那行.

用法 (来源机):
  MBP:        python3 glm_usage_extract.py --host mbp --out ~/.claude/glm-usage/glm-usage-mbp.json --summary
  家服云脉 VM: ssh yunmai-vm 'python3 - --host yunmai-vm' < glm_usage_extract.py   # 帧写 stdout
只用标准库, 兼容 python3.8+ (macOS 自带 3.9). 与 glm_usage_aggregate.py 分开放, 因为只有本文件要拷到来源机.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from datetime import datetime, timezone

SCHEMA = 1
# 标签长度上限: 与家服 aggregate 的 valid_record 一致, 超长 id 丢弃、模型/项目名截断, 防单条记录撑爆快照
ID_MAX, TS_MAX, MODEL_MAX, PROJECT_MAX = 200, 64, 64, 128
TOKEN_KEYS = ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens")


def _tok(v) -> int:
    return v if isinstance(v, int) and not isinstance(v, bool) and v > 0 else 0


def _utf8_ok(s: str) -> bool:
    try:
        s.encode("utf-8")
        return True
    except UnicodeEncodeError:  # JSON 里转义出的孤立代理项(\ud800)会让 UTF-8 输出崩掉
        return False


def project_name(cwd, workspace: str) -> str:
    """只取项目目录名: 工作区下第一层目录; 工作区根 → "(工作区根)"; 不在工作区下 → cwd 末段; 无 cwd → "(未知)".
    不从 projects/<slug> 目录名反推: slug 是 cwd 的 / → - 有损编码, 分不清目录边界, 可能把多段路径当项目名带出."""
    if isinstance(cwd, str) and cwd:
        parts = [p for p in cwd.replace("\\", "/").split("/") if p]
        if workspace in parts:
            rest = parts[parts.index(workspace) + 1:]
            return rest[0] if rest else "(工作区根)"
        if parts:
            return parts[-1]
    return "(未知)"


def extract(config_dir: str, workspace: str):
    """返回 (best: id → record, stats, config_dir_found). record = [id, ts, model, project, in, cr, cc, out]"""
    root = os.path.join(config_dir, "projects")
    stats = {"files": 0, "unreadable_files": 0, "raw_usage_lines": 0, "bad_lines": 0, "no_id": 0, "synthetic": 0}
    best = {}
    if not os.path.isdir(root):
        return best, stats, os.path.isdir(config_dir)
    # 递归: 子 agent 会话落在 projects/<slug>/<session>/subagents/*.jsonl
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for fn in sorted(filenames):
            if not fn.endswith(".jsonl"):
                continue
            stats["files"] += 1
            try:
                fh = open(os.path.join(dirpath, fn), "r", encoding="utf-8", errors="replace")
            except OSError:
                stats["unreadable_files"] += 1
                continue
            with fh:
                for line in fh:
                    if '"usage"' not in line:  # 绝大多数行(用户消息/工具结果)不带 usage, 免 json 解析
                        continue
                    try:
                        d = json.loads(line)
                    except (ValueError, RecursionError):
                        stats["bad_lines"] += 1
                        continue
                    msg = d.get("message") if isinstance(d, dict) else None
                    usage = msg.get("usage") if isinstance(msg, dict) else None
                    if not isinstance(usage, dict):
                        continue
                    model = msg.get("model")
                    if model == "<synthetic>":  # Claude Code 本地合成的占位回复, 不经网关
                        stats["synthetic"] += 1
                        continue
                    stats["raw_usage_lines"] += 1
                    mid = msg.get("id")
                    if not isinstance(mid, str) or not mid:
                        stats["no_id"] += 1
                        continue
                    if len(mid) > ID_MAX:
                        stats["bad_lines"] += 1
                        continue
                    toks = [_tok(usage.get(k)) for k in TOKEN_KEYS]
                    ts = d.get("timestamp")
                    rec = [
                        mid,
                        ts if isinstance(ts, str) and len(ts) <= TS_MAX else "",
                        (model if isinstance(model, str) and model else "(未知)")[:MODEL_MAX],
                        project_name(d.get("cwd"), workspace)[:PROJECT_MAX],
                    ] + toks
                    if not all(_utf8_ok(x) for x in rec[:4]):
                        stats["bad_lines"] += 1
                        continue
                    prev = best.get(mid)
                    if prev is None or sum(toks) > sum(prev[4:]):
                        best[mid] = rec
    return best, stats, True


def build_frame(host: str, config_dir: str, workspace: str, now: datetime | None = None) -> dict:
    best, stats, found = extract(config_dir, workspace)
    now = now or datetime.now(timezone.utc)
    frame = {
        "schema": SCHEMA,
        "kind": "glm-usage-host",
        "host": host,
        "generated_at": now.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "config_dir_found": found,
        "unique_msgs": len(best),
        "records": sorted(best.values(), key=lambda r: (r[1], r[0])),
    }
    frame.update(stats)
    return frame


def write_atomic(path: str, obj: dict) -> None:
    d = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(prefix="." + os.path.basename(path) + ".", dir=d)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def summary_line(frame: dict) -> str:
    t = [0, 0, 0, 0]
    for r in frame["records"]:
        for i in range(4):
            t[i] += r[4 + i]
    return (
        "host={host} files={files} raw_usage_lines={raw} unique_msgs={uniq} no_id={noid} "
        "input={0} cache_read={1} cache_creation={2} output={3} total={tot}"
    ).format(*t, host=frame["host"], files=frame["files"], raw=frame["raw_usage_lines"],
             uniq=frame["unique_msgs"], noid=frame["no_id"], tot=sum(t))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="cpclaude 用量抽取(只输出数字)")
    ap.add_argument("--host", required=True, help="来源机标识, 与家服 remote-glm/<host>.json 文件名一致")
    ap.add_argument("--config-dir", default="~/.claude-glm-config")
    ap.add_argument("--workspace-name", default="chanshuWorkSpace")
    ap.add_argument("--out", help="原子写到该文件; 不给则写 stdout")
    ap.add_argument("--summary", action="store_true", help="stderr 打一行合计(纯数字), 对账用")
    a = ap.parse_args(argv)
    frame = build_frame(a.host, os.path.expanduser(a.config_dir), a.workspace_name)
    if not frame["config_dir_found"]:
        # 连 config dir 都没有 = 装错机器 / 路径写错; 不出空帧, 让下游保留上一帧而不是拿 0 条覆盖
        print("glm_usage_extract: config dir 不存在, 不输出帧", file=sys.stderr)
        return 3
    if a.out:
        write_atomic(os.path.expanduser(a.out), frame)
    else:
        json.dump(frame, sys.stdout, ensure_ascii=False, separators=(",", ":"))
        sys.stdout.write("\n")
    if a.summary:
        print(summary_line(frame), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
