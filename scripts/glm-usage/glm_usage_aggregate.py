#!/usr/bin/env python3
"""
glm_usage_aggregate — 家服侧: 合并各来源机的 cpclaude 用量帧 → jiaxu-portal 快照.

输入: /data/claude-usage/remote-glm/<host>.json  (glm_usage_extract.py 产物, 只有数字)
        mbp.json        ← MBP launchd 本地抽取后 rsync 上来 (mbp-install.sh)
        yunmai-vm.json  ← collect-vm.sh 经 ssh 在 VM 内抽取
账本: /data/claude-usage/glm-usage/ledger/<host>.json  (按 message.id 并集累积, 只增不减)
输出: /data/portal-state/glm-usage.json  (原子写: 同目录 tmp + rename; schema=1)

为什么要账本: 来源帧是全量重扫, 而 Claude Code 默认清理 30 天前的会话 jsonl —— 老记录会从帧里消失;
帧缺失 / 损坏时也不能让快照归零. 账本把每次看到的记录按 id 并集保留, 帧只负责「新增」.

口径:
- 按 message.id 去重: 同机同 id 取 token 合计最大那条; 跨机同 id (误配才会出现) 同样只计一次, 记 cross_host_dups
- host 分桶: 每条去重后的回复恰好落进一个 host 桶, 各桶之和 = 总计
- 日 / 月边界 = 北京时间 (UTC+8), 与 portal 其它卡一致
- 只统计 token, 不折算金额: 部门网关没有可引用的价目出处
- 额度: 2026-09-15 实测网关无额度/余额接口 → quota.status=unavailable, 不编数字 (探测细节见 vault, 本仓库公开不落网关信息)
- 报错文案一律固定措辞, 不回显帧里的任何值 (帧来自来源机, 视为不可信)
"""
from __future__ import annotations

import argparse
import errno
import json
import os
import re
import stat
import sys
import tempfile
from datetime import datetime, timedelta, timezone

SCHEMA = 1
HOST_SCHEMA = 1
LEDGER_SCHEMA = 1
BJ = timezone(timedelta(hours=8))
DEFAULT_REMOTE_DIR = "/data/claude-usage/remote-glm"
# 账本放 root 所有目录: 本脚本以 root 跑, 不在 jiaxu 可写的地方留 root 写入的状态
DEFAULT_LEDGER_DIR = "/var/lib/glm-usage/ledger"
DEFAULT_OUT = "/data/portal-state/glm-usage.json"
HOST_MAX_BYTES = 64 * 1024 * 1024
# MBP 下班断网后不再同步是常态; 超过 30min 只标「未同步」, 历史记录照常计入
HOST_STALE_SECONDS = 30 * 60
FUTURE_SKEW_SECONDS = 5 * 60
TOP_PROJECTS = 20
TOP_MODELS = 20
# 与 extract 一致的标签上限; 快照发布前再按总字节兜底 (portal 读帧上限 256KB)
ID_MAX, TS_MAX, MODEL_MAX, PROJECT_MAX = 200, 64, 64, 128
SNAPSHOT_MAX_BYTES = 200 * 1024
HOST_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")
# 预期来源机: 文件缺失也要在卡片上报「未收到该机帧」, 不能静默少算一台
EXPECTED_HOSTS = {"mbp": "MBP（公司）", "yunmai-vm": "家服云脉 VM"}

# 探测细节(路径/状态码/网关域名)只记在私有 vault: 本仓库公开, 不写部门网关信息
QUOTA = {
    "status": "unavailable",
    "probed_at": "2026-09-15",
    "detail": "部门网关只读探测未发现额度/余额接口：计费类路径 404，管理类路径 401（API key 无权，疑需控制台登录态），响应头与 usage 均无余额/限额字段",
}


def parse_ts(s):
    if not isinstance(s, str) or not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        dt = dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        dt.astimezone(BJ)  # 9999-12-31T20:00Z 这类值换算北京时会溢出: 在这里拦下, 当作无时间戳
    except (ValueError, OverflowError):
        return None
    return dt


def iso_utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _count(v):
    return v if isinstance(v, int) and not isinstance(v, bool) and v >= 0 else None


def _utf8_ok(s: str) -> bool:
    try:
        s.encode("utf-8")
        return True
    except UnicodeEncodeError:  # 帧里转义出的孤立代理项(\ud800)会让账本/快照的 UTF-8 输出崩掉
        return False


def valid_record(r) -> bool:
    return (
        isinstance(r, list)
        and len(r) == 8
        and isinstance(r[0], str) and bool(r[0])
        and all(isinstance(x, str) for x in r[1:4])
        and len(r[0]) <= ID_MAX and len(r[1]) <= TS_MAX and len(r[2]) <= MODEL_MAX and len(r[3]) <= PROJECT_MAX
        and all(_utf8_ok(x) for x in r[0:4])
        and all(_count(x) is not None for x in r[4:8])
    )


class _NotRegularFile(Exception):
    pass


class _TooLarge(Exception):
    pass


class LedgerUnreadable(Exception):
    """账本存在却读不到(I/O 错误/权限): 不能当损坏去重建, 本轮整体不发布."""


def read_regular_file(path: str, max_bytes: int) -> bytes:
    """以 root 读 jiaxu 可写目录里的帧: 不跟随符号链接、只收普通文件(FIFO/设备会卡死或读不完)、
    经同一个 fd 最多读 max_bytes+1 字节 —— 不先 stat 再 open, 两步之间被替换也绕不过上限."""
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | getattr(os, "O_CLOEXEC", 0))
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise _NotRegularFile()
        chunks, n = [], 0
        while n <= max_bytes:
            b = os.read(fd, min(1 << 20, max_bytes + 1 - n))
            if not b:
                break
            chunks.append(b)
            n += len(b)
        if n > max_bytes:
            raise _TooLarge()
        return b"".join(chunks)
    finally:
        os.close(fd)


def total(r) -> int:
    return r[4] + r[5] + r[6] + r[7]


def keep_max(best: dict, r) -> None:
    prev = best.get(r[0])
    if prev is None or total(r) > total(prev):
        best[r[0]] = r


def load_host(path: str, host: str, now: datetime):
    """读一台来源机的帧. 返回 (info, best: id → record); 帧坏时 best 为空、info.error 说明原因."""
    info = {
        "host": host, "label": EXPECTED_HOSTS.get(host, host), "ok": False, "error": None,
        "source_generated_at": None, "age_seconds": None, "stale": True, "config_dir_found": None,
        "files": None, "raw_usage_lines": None, "unique_msgs": None, "counted_msgs": 0,
        "ledger_msgs": 0, "invalid_records": 0,
    }

    def fail(msg):
        info["error"] = msg
        return info, {}

    try:
        raw = read_regular_file(path, HOST_MAX_BYTES)
    except FileNotFoundError:
        return fail("未收到该机帧（同步未安装或从未成功）")
    except _TooLarge:
        return fail("帧过大，拒收")
    except _NotRegularFile:
        return fail("帧不是普通文件，拒收")
    except OSError as e:
        return fail("帧是符号链接，拒收" if e.errno == errno.ELOOP else "读帧失败（errno %s）" % e.errno)
    try:
        frame = json.loads(raw.decode("utf-8"))
    except (ValueError, RecursionError):  # UnicodeDecodeError 是 ValueError 子类
        return fail("帧不是合法 JSON")
    if not isinstance(frame, dict) or frame.get("kind") != "glm-usage-host":
        return fail("帧结构不符（kind）")
    if frame.get("schema") != HOST_SCHEMA:
        return fail("帧 schema 版本不符（期望 %d）" % HOST_SCHEMA)
    if frame.get("host") != host:
        return fail("帧内 host 与文件名不符，拒收（防重复计数）")
    if frame.get("config_dir_found") is False:
        return fail("来源机未找到 cpclaude 配置目录，拒收（账本保留旧数据）")
    gen = parse_ts(frame.get("generated_at"))
    if gen is None:
        return fail("帧缺 generated_at")
    age = (now - gen).total_seconds()
    if age < -FUTURE_SKEW_SECONDS:
        return fail("帧时间在未来（来源机时钟偏差？）")
    records = frame.get("records")
    if not isinstance(records, list):
        return fail("帧缺 records")

    best, invalid = {}, 0
    for r in records:
        if valid_record(r):
            keep_max(best, r)
        else:
            invalid += 1
    found = frame.get("config_dir_found")
    info.update(
        ok=True,
        source_generated_at=iso_utc(gen),
        age_seconds=max(0, int(age)),
        stale=age > HOST_STALE_SECONDS,
        config_dir_found=found if isinstance(found, bool) else None,
        files=_count(frame.get("files")),
        raw_usage_lines=_count(frame.get("raw_usage_lines")),
        unique_msgs=len(best),
        invalid_records=invalid,
    )
    return info, best


def load_ledger(path: str):
    """→ (id → record, error). 缺文件 = 空账本; 内容损坏 → 改名 .corrupt 留证后从空重建, 原因带到卡片;
    文件在却读不到 → 抛 LedgerUnreadable (瞬时 I/O 错误不能拿可能已被清理的来源帧去覆盖累积历史)."""
    try:
        with open(path, "rb") as f:
            raw = f.read()
    except FileNotFoundError:
        return {}, None
    except OSError as e:
        raise LedgerUnreadable("errno %s" % e.errno)
    try:
        obj = json.loads(raw.decode("utf-8"))
    except (ValueError, RecursionError):
        obj = None
    records = obj.get("records") if isinstance(obj, dict) and obj.get("kind") == "glm-usage-ledger" else None
    if not isinstance(records, list):
        try:
            os.replace(path, path + ".corrupt")
        except OSError:
            pass
        return {}, "家服账本损坏，已另存 .corrupt 并重建"
    best = {}
    for r in records:
        if valid_record(r):
            keep_max(best, r)
    return best, None


def discover_hosts(*dirs) -> list:
    extra = set()
    for d in dirs:
        if not d:
            continue
        try:
            for fn in os.listdir(d):
                if fn.endswith(".json") and not fn.startswith(".") and HOST_RE.match(fn[:-5]):
                    extra.add(fn[:-5])
        except OSError:
            pass
    return list(EXPECTED_HOSTS) + sorted(extra - set(EXPECTED_HOSTS))


def collect_hosts(remote_dir: str, ledger_dir, now: datetime):
    """读各机帧并与账本按 id 并集; 账本有变化才原子重写. 返回 (host infos, host → id → record)."""
    infos, per_host = [], {}
    for h in discover_hosts(remote_dir, ledger_dir):
        info, records = load_host(os.path.join(remote_dir, h + ".json"), h, now)
        if ledger_dir:
            lpath = os.path.join(ledger_dir, h + ".json")
            ledger, lerr = load_ledger(lpath)
            merged = dict(ledger)
            for r in records.values():
                keep_max(merged, r)
            if lerr:
                info["error"] = lerr if info["error"] is None else info["error"] + "；" + lerr
            if merged != ledger:
                write_atomic(lpath, {
                    "schema": LEDGER_SCHEMA, "kind": "glm-usage-ledger", "host": h, "updated_at": iso_utc(now),
                    "records": sorted(merged.values(), key=lambda r: (r[1], r[0])),
                })
            records = merged
        info["ledger_msgs"] = len(records)
        infos.append(info)
        if records:
            per_host[h] = records
    return infos, per_host


def merge(per_host: dict):
    """跨机去重: 同 id 只保留 token 合计最大的一条 (并列取 host 字典序靠前者). 返回 (id → (host, rec), 重复数)"""
    chosen, dups = {}, 0
    for host in sorted(per_host):
        for mid, r in per_host[host].items():
            prev = chosen.get(mid)
            if prev is None:
                chosen[mid] = (host, r)
                continue
            dups += 1
            if total(r) > total(prev[1]):
                chosen[mid] = (host, r)
    return chosen, dups


def new_bucket() -> dict:
    return {"input": 0, "cache_read": 0, "cache_creation": 0, "output": 0, "total": 0, "msgs": 0}


def add(b: dict, r) -> None:
    b["input"] += r[4]
    b["cache_read"] += r[5]
    b["cache_creation"] += r[6]
    b["output"] += r[7]
    b["total"] += total(r)
    b["msgs"] += 1


def new_window() -> dict:
    return {"totals": new_bucket(), "by_model": {}, "by_host": {}, "by_project": {}, "projects_omitted": 0}


def add_window(w: dict, host: str, r) -> None:
    add(w["totals"], r)
    for key, name in (("by_model", r[2]), ("by_host", host), ("by_project", r[3])):
        add(w[key].setdefault(name, new_bucket()), r)


def cap_buckets(w: dict, key: str, top: int) -> int:
    """桶数截到 top, 其余合并成「(其他 N 个)」; 返回被合并的个数."""
    items = sorted(w[key].items(), key=lambda kv: (-kv[1]["total"], kv[0]))
    if len(items) <= top:
        return 0
    rest = new_bucket()
    for _, b in items[top:]:
        for k in rest:
            rest[k] += b[k]
    kept = dict(items[:top])
    kept["(其他 %d 个)" % (len(items) - top)] = rest
    w[key] = kept
    return len(items) - top


def build_snapshot(infos: list, per_host: dict, now: datetime) -> dict:
    now_bj = now.astimezone(BJ)
    month, today = now_bj.strftime("%Y-%m"), now_bj.strftime("%Y-%m-%d")
    chosen, cross = merge(per_host)

    windows = {"month": new_window(), "today": new_window()}
    all_time, undated, counted = new_bucket(), 0, {}
    for host, r in chosen.values():
        counted[host] = counted.get(host, 0) + 1
        add(all_time, r)
        dt = parse_ts(r[1])
        if dt is None:
            undated += 1
            continue
        bj = dt.astimezone(BJ)
        if bj.strftime("%Y-%m") == month:
            add_window(windows["month"], host, r)
            if bj.strftime("%Y-%m-%d") == today:
                add_window(windows["today"], host, r)
    for info in infos:
        info["counted_msgs"] = counted.get(info["host"], 0)
    for w in windows.values():
        w["projects_omitted"] = cap_buckets(w, "by_project", TOP_PROJECTS)
        cap_buckets(w, "by_model", TOP_MODELS)

    ok = [i for i in infos if i["ok"]]
    return {
        "schema": SCHEMA,
        "kind": "glm-usage",
        "generated_at": iso_utc(now),
        "tz": "Asia/Shanghai",
        "month": month,
        "today": today,
        "hosts": infos,
        "dedup": {
            # 本轮来源帧: 原始 usage 行 → 帧内去重后条数; 账本累积后跨机去重计入条数
            "raw_usage_lines": sum(i["raw_usage_lines"] or 0 for i in ok),
            "frame_unique_msgs": sum(i["unique_msgs"] or 0 for i in ok),
            "counted_msgs": len(chosen),
            "cross_host_dups": cross,
            "undated_msgs": undated,
        },
        "windows": windows,
        "all_time": {"totals": all_time},
        "quota": QUOTA,
    }


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


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="合并 cpclaude 用量帧 → portal 快照")
    ap.add_argument("--remote-dir", default=DEFAULT_REMOTE_DIR)
    ap.add_argument("--ledger-dir", default=DEFAULT_LEDGER_DIR)
    ap.add_argument("--out", default=DEFAULT_OUT)
    a = ap.parse_args(argv)
    now = datetime.now(timezone.utc)
    os.makedirs(a.ledger_dir, exist_ok=True)
    try:
        infos, per_host = collect_hosts(a.remote_dir, a.ledger_dir, now)
    except LedgerUnreadable as e:
        # 不发布: 卡片按快照陈旧降级, 比悄悄发一份缩水的数更容易被发现
        print("FAILED: 账本不可读（%s），本轮不发布快照" % e, file=sys.stderr)
        return 1
    snap = build_snapshot(infos, per_host, now)
    size = len(json.dumps(snap, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    if size > SNAPSHOT_MAX_BYTES:
        # 不发布超限快照: portal 读帧上限 256KB, 发了卡片也只会报「过大」; 让它按陈旧降级
        print("FAILED: 快照 %dB 超过上限 %dB，本轮不发布" % (size, SNAPSHOT_MAX_BYTES), file=sys.stderr)
        return 1
    write_atomic(a.out, snap)
    # journal 只留数字与状态, 不含任何会话内容
    hosts = " ".join(
        "%s:%s/%d" % (i["host"], ("ok" if not i["stale"] else "stale") if i["ok"] else "err", i["ledger_msgs"])
        for i in snap["hosts"]
    )
    m = snap["windows"]["month"]["totals"]
    print("ok %s month_total=%d counted=%d cross_dups=%d" % (hosts, m["total"], snap["dedup"]["counted_msgs"], snap["dedup"]["cross_host_dups"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
