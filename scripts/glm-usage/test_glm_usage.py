"""cpclaude 用量链路单测: 抽取去重 / 项目名 / 跨机去重 / host 分桶 / 北京时间分窗 / 帧降级 / 账本累积 / 原子写.
运行: python3 -m pytest scripts/glm-usage/test_glm_usage.py -q
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import glm_usage_aggregate as agg  # noqa: E402
import glm_usage_extract as ext  # noqa: E402

NOW = datetime(2026, 9, 15, 7, 0, tzinfo=timezone.utc)  # 北京 15:00


def assistant(mid, ts, model="glm-5.2", cwd="/Users/u/chanshuWorkSpace/proj-a", i=0, cr=0, cc=0, o=0, text="SECRET-CODE"):
    return json.dumps({
        "type": "assistant", "timestamp": ts, "cwd": cwd, "sessionId": "s1",
        "message": {"id": mid, "model": model, "role": "assistant", "content": [{"type": "text", "text": text}],
                    "usage": {"input_tokens": i, "cache_read_input_tokens": cr, "cache_creation_input_tokens": cc, "output_tokens": o}},
    }, ensure_ascii=False)


def write_jsonl(root, rel, lines):
    p = os.path.join(root, "projects", rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


# ---------- 抽取(来源机) ----------

def test_extract_dedups_streaming_chunks_keeping_max_total(tmp_path):
    cfg = str(tmp_path)
    write_jsonl(cfg, "-Users-u-chanshuWorkSpace-proj-a/s1.jsonl", [
        json.dumps({"type": "user", "message": {"role": "user", "content": "prompt text"}}),
        assistant("msg_1", "2026-09-15T01:00:00.000Z", i=10, cr=100, o=1),   # 流式首块
        assistant("msg_1", "2026-09-15T01:00:01.000Z", i=10, cr=100, o=50),  # 同 id 终块, 合计最大
        assistant("msg_1", "2026-09-15T01:00:00.500Z", i=10, cr=100, o=20),
        assistant("msg_2", "2026-09-15T02:00:00.000Z", i=5, o=5),
        "{not json with \"usage\"",
        '{"usage": ' + "[" * 100000 + "]" * 100000 + "}",  # 深嵌套行: 计坏行, 不让整机抽取崩掉
    ])
    frame = ext.build_frame("mbp", cfg, "chanshuWorkSpace", now=NOW)
    assert frame["raw_usage_lines"] == 4
    assert frame["unique_msgs"] == 2
    assert frame["bad_lines"] == 2
    by_id = {r[0]: r for r in frame["records"]}
    assert by_id["msg_1"][4:] == [10, 100, 0, 50]
    # 帧里只有数字与标识, 会话文本 / prompt 不出机
    blob = json.dumps(frame, ensure_ascii=False)
    assert "SECRET-CODE" not in blob and "prompt text" not in blob


def test_extract_skips_synthetic_and_counts_missing_id(tmp_path):
    cfg = str(tmp_path)
    write_jsonl(cfg, "slug/s.jsonl", [
        assistant("msg_s", "2026-09-15T01:00:00Z", model="<synthetic>", o=0),
        assistant("", "2026-09-15T01:00:00Z", o=9),
        assistant("msg_ok", "2026-09-15T01:00:00Z", o=3),
    ])
    frame = ext.build_frame("mbp", cfg, "chanshuWorkSpace", now=NOW)
    assert frame["synthetic"] == 1 and frame["no_id"] == 1 and frame["unique_msgs"] == 1


def test_extract_rejects_lone_surrogate_strings(tmp_path):
    cfg = str(tmp_path)
    bad = '{"type":"assistant","timestamp":"2026-09-15T01:00:00Z","cwd":"/w/chanshuWorkSpace/p","message":{"id":"m_bad","model":"glm-\\ud800","usage":{"output_tokens":5}}}'
    write_jsonl(cfg, "slug/s.jsonl", [bad, assistant("m_ok", "2026-09-15T01:00:00Z", o=1)])
    out = tmp_path / "f.json"
    assert ext.main(["--host", "mbp", "--config-dir", cfg, "--out", str(out)]) == 0
    frame = json.loads(out.read_text(encoding="utf-8"))
    assert frame["unique_msgs"] == 1 and frame["bad_lines"] == 1


def test_extract_recurses_into_subagent_dirs(tmp_path):
    cfg = str(tmp_path)
    write_jsonl(cfg, "slug/s1.jsonl", [assistant("msg_a", "2026-09-15T01:00:00Z", o=1)])
    write_jsonl(cfg, "slug/s1/subagents/agent-x.jsonl", [assistant("msg_b", "2026-09-15T01:00:00Z", o=1)])
    assert ext.build_frame("mbp", cfg, "chanshuWorkSpace", now=NOW)["unique_msgs"] == 2


def test_extract_missing_config_dir_refuses_to_emit(tmp_path, capsys):
    frame = ext.build_frame("mbp", str(tmp_path / "nope"), "chanshuWorkSpace", now=NOW)
    assert frame["config_dir_found"] is False and frame["records"] == []
    out = tmp_path / "f.json"
    assert ext.main(["--host", "mbp", "--config-dir", str(tmp_path / "nope"), "--out", str(out)]) == 3
    assert not out.exists()
    assert capsys.readouterr().out == ""  # stdout 模式同样不出空帧


def test_project_name_only_directory_names():
    ws = "chanshuWorkSpace"
    assert ext.project_name("/Users/u/chanshuWorkSpace/proj-a/src/main", ws) == "proj-a"
    assert ext.project_name("/home/ym/chanshuWorkSpace", ws) == "(工作区根)"
    assert ext.project_name("/tmp/other", ws) == "other"
    assert ext.project_name("/Users/u/chanshuWorkSpace-backup/x", ws) == "x"  # 相似前缀不当工作区
    # 无 cwd 不从 slug 反推(有损编码分不清目录边界)
    assert ext.project_name(None, ws) == "(未知)"
    assert ext.project_name("", ws) == "(未知)"


def test_extract_out_is_atomic(tmp_path):
    cfg = tmp_path / "cfg"
    cfg.mkdir()
    out = tmp_path / "f.json"
    assert ext.main(["--host", "mbp", "--config-dir", str(cfg), "--out", str(out)]) == 0
    assert json.loads(out.read_text())["kind"] == "glm-usage-host"
    assert sorted(p.name for p in tmp_path.iterdir()) == ["cfg", "f.json"]  # 没有残留 tmp


# ---------- 合并(家服) ----------

def host_frame(host, records, generated_at="2026-09-15T06:55:00Z", **over):
    f = {"schema": 1, "kind": "glm-usage-host", "host": host, "generated_at": generated_at,
         "config_dir_found": True, "files": 1, "raw_usage_lines": len(records), "unique_msgs": len(records), "records": records}
    f.update(over)
    return f


def put(d, host, frame):
    with open(os.path.join(d, host + ".json"), "w", encoding="utf-8") as f:
        f.write(frame if isinstance(frame, str) else json.dumps(frame))


def rec(mid, ts, model="glm-5.2", project="proj-a", i=0, cr=0, cc=0, o=0):
    return [mid, ts, model, project, i, cr, cc, o]


def snap(remote, ledger=None, now=NOW):
    infos, per_host = agg.collect_hosts(str(remote), str(ledger) if ledger else None, now)
    return agg.build_snapshot(infos, per_host, now)


def test_host_buckets_partition_totals_without_double_count(tmp_path):
    d = str(tmp_path)
    put(d, "mbp", host_frame("mbp", [rec("m1", "2026-09-15T01:00:00Z", i=10, cr=100, o=5),
                                     rec("m2", "2026-09-02T01:00:00Z", model="glm-5.3", project="proj-b", i=1, o=1)]))
    put(d, "yunmai-vm", host_frame("yunmai-vm", [rec("v1", "2026-09-15T03:00:00Z", i=7, o=3)]))
    s = snap(d)
    month = s["windows"]["month"]
    assert month["totals"]["total"] == 115 + 2 + 10
    assert sum(b["total"] for b in month["by_host"].values()) == month["totals"]["total"]
    assert month["by_host"]["mbp"]["msgs"] == 2 and month["by_host"]["yunmai-vm"]["msgs"] == 1
    assert month["by_model"]["glm-5.3"]["total"] == 2
    assert month["by_project"]["proj-a"]["total"] == 125
    assert s["windows"]["today"]["totals"]["total"] == 125  # m2 是 09-02, 不进今日
    assert s["dedup"] == {"raw_usage_lines": 3, "frame_unique_msgs": 3, "counted_msgs": 3, "cross_host_dups": 0, "undated_msgs": 0}


def test_cross_host_duplicate_id_counted_once(tmp_path):
    d = str(tmp_path)
    put(d, "mbp", host_frame("mbp", [rec("dup", "2026-09-15T01:00:00Z", o=5)]))
    put(d, "yunmai-vm", host_frame("yunmai-vm", [rec("dup", "2026-09-15T01:00:00Z", o=9)]))
    s = snap(d)
    assert s["dedup"]["cross_host_dups"] == 1
    t = s["windows"]["month"]["totals"]
    assert (t["output"], t["total"], t["msgs"]) == (9, 9, 1)
    assert list(s["windows"]["month"]["by_host"]) == ["yunmai-vm"]


def test_intra_host_duplicate_keeps_max(tmp_path):
    d = str(tmp_path)
    put(d, "mbp", host_frame("mbp", [rec("x", "2026-09-15T01:00:00Z", o=1), rec("x", "2026-09-15T01:00:01Z", o=4)]))
    assert snap(d)["windows"]["month"]["totals"]["output"] == 4


def test_beijing_day_and_month_boundaries(tmp_path):
    d = str(tmp_path)
    put(d, "mbp", host_frame("mbp", [
        rec("a", "2026-08-31T16:30:00Z", o=1),   # 北京 09-01 00:30 → 本月
        rec("b", "2026-08-31T15:30:00Z", o=2),   # 北京 08-31 23:30 → 上月
        rec("c", "2026-09-14T16:00:00Z", o=4),   # 北京 09-15 00:00 → 今日
        rec("e", "2026-09-14T15:59:59Z", o=8),   # 北京 09-14 23:59 → 非今日
        rec("f", "not-a-time", o=16),
        rec("g", "9999-12-31T20:00:00Z", o=32),  # 换算北京时溢出: 当无时间戳, 不让整次快照崩掉
    ]))
    s = snap(d)
    assert s["month"] == "2026-09" and s["today"] == "2026-09-15"
    assert s["windows"]["month"]["totals"]["output"] == 1 + 4 + 8
    assert s["windows"]["today"]["totals"]["output"] == 4
    assert s["all_time"]["totals"]["output"] == 63
    assert s["dedup"]["undated_msgs"] == 2


def test_missing_bad_and_mismatched_host_frames_degrade_per_host(tmp_path):
    d = str(tmp_path)
    put(d, "yunmai-vm", "[" * 200000)  # 深嵌套: RecursionError 也只算这台帧坏
    put(d, "extra-box", host_frame("other-name", [rec("z", "2026-09-15T01:00:00Z", o=100)]))
    s = snap(d)
    hosts = {h["host"]: h for h in s["hosts"]}
    assert hosts["mbp"]["ok"] is False and "未收到" in hosts["mbp"]["error"]
    assert hosts["yunmai-vm"]["ok"] is False and "JSON" in hosts["yunmai-vm"]["error"]
    assert hosts["extra-box"]["ok"] is False and "host" in hosts["extra-box"]["error"]
    assert s["windows"]["month"]["totals"]["total"] == 0


def test_schema_mismatch_future_stale_and_no_config_dir(tmp_path):
    d = str(tmp_path)
    put(d, "mbp", host_frame("mbp", [], schema="PRIVATE-" + "x" * 5000))
    put(d, "yunmai-vm", host_frame("yunmai-vm", [rec("v", "2026-09-15T01:00:00Z", o=1)], generated_at="2026-09-15T05:00:00Z"))
    put(d, "future", host_frame("future", [], generated_at="2026-09-15T08:00:00Z"))
    put(d, "nocfg", host_frame("nocfg", [], config_dir_found=False))
    s = snap(d)
    hosts = {h["host"]: h for h in s["hosts"]}
    assert "schema" in hosts["mbp"]["error"]
    assert "PRIVATE" not in json.dumps(s, ensure_ascii=False)  # 报错不回显帧里的值
    # 2 小时没同步: 仍 ok、记录照常计入, 只标 stale
    assert hosts["yunmai-vm"]["ok"] is True and hosts["yunmai-vm"]["stale"] is True and hosts["yunmai-vm"]["counted_msgs"] == 1
    assert "未来" in hosts["future"]["error"]
    assert hosts["nocfg"]["ok"] is False and "配置目录" in hosts["nocfg"]["error"]


def test_ledger_keeps_history_when_source_prunes_or_frame_breaks(tmp_path):
    remote, ledger = tmp_path / "remote", tmp_path / "ledger"
    remote.mkdir()
    ledger.mkdir()
    put(str(remote), "mbp", host_frame("mbp", [rec("old", "2026-09-01T01:00:00Z", o=7), rec("new", "2026-09-15T01:00:00Z", o=1)]))
    assert snap(remote, ledger)["windows"]["month"]["totals"]["output"] == 8
    # 来源机清掉了老 jsonl: 帧里只剩 new(且流式终块更大), 账本仍保留 old
    put(str(remote), "mbp", host_frame("mbp", [rec("new", "2026-09-15T01:00:00Z", o=3)]))
    s = snap(remote, ledger)
    assert s["windows"]["month"]["totals"]["output"] == 10
    assert s["dedup"]["frame_unique_msgs"] == 1 and s["dedup"]["counted_msgs"] == 2
    # 帧坏掉: 快照不归零, host 如实报错
    put(str(remote), "mbp", "{broken")
    s = snap(remote, ledger)
    assert s["windows"]["month"]["totals"]["output"] == 10
    assert s["hosts"][0]["ok"] is False and s["hosts"][0]["counted_msgs"] == 2
    assert sorted(p.name for p in ledger.iterdir()) == ["mbp.json"]  # 原子写无残留


def test_corrupt_ledger_is_set_aside_and_rebuilt(tmp_path):
    remote, ledger = tmp_path / "remote", tmp_path / "ledger"
    remote.mkdir()
    ledger.mkdir()
    (ledger / "mbp.json").write_text("{nope")
    put(str(remote), "mbp", host_frame("mbp", [rec("a", "2026-09-15T01:00:00Z", o=2)]))
    s = snap(remote, ledger)
    assert s["windows"]["month"]["totals"]["output"] == 2
    assert "账本损坏" in s["hosts"][0]["error"]
    assert (ledger / "mbp.json.corrupt").exists()
    assert json.loads((ledger / "mbp.json").read_text())["kind"] == "glm-usage-ledger"


def test_long_labels_rejected_and_model_buckets_capped(tmp_path, monkeypatch):
    monkeypatch.setattr(agg, "TOP_MODELS", 2)
    d = str(tmp_path)
    put(d, "mbp", host_frame("mbp", [rec("big", "2026-09-15T01:00:00Z", model="m" * 140000, o=99)]
                             + [rec("x%d" % n, "2026-09-15T01:00:00Z", model="glm-%d" % n, o=n + 1) for n in range(4)]))
    s = snap(d)
    hosts = {h["host"]: h for h in s["hosts"]}
    assert hosts["mbp"]["invalid_records"] == 1
    assert list(s["windows"]["month"]["by_model"]) == ["glm-3", "glm-2", "(其他 2 个)"]


def test_extract_truncates_labels(tmp_path):
    cfg = str(tmp_path)
    write_jsonl(cfg, "slug/s.jsonl", [assistant("m1", "2026-09-15T01:00:00Z", model="g" * 500, cwd="/w/chanshuWorkSpace/" + "p" * 500, o=1),
                                      assistant("i" * 300, "2026-09-15T01:00:00Z", o=1)])
    frame = ext.build_frame("mbp", cfg, "chanshuWorkSpace", now=NOW)
    assert frame["unique_msgs"] == 1 and frame["bad_lines"] == 1
    r = frame["records"][0]
    assert len(r[2]) == ext.MODEL_MAX and len(r[3]) == ext.PROJECT_MAX and agg.valid_record(r)


def test_oversized_snapshot_not_published(tmp_path, monkeypatch):
    monkeypatch.setattr(agg, "SNAPSHOT_MAX_BYTES", 500)
    remote, out = tmp_path / "remote", tmp_path / "glm-usage.json"
    remote.mkdir()
    put(str(remote), "mbp", host_frame("mbp", [rec("p%d" % n, "2026-09-15T01:00:00Z", project="proj-%d" % n, o=1) for n in range(15)]))
    assert agg.main(["--remote-dir", str(remote), "--ledger-dir", str(tmp_path / "ledger"), "--out", str(out)]) == 1
    assert not out.exists()


def test_bucket_cny_sums_match_totals_after_capping(tmp_path, monkeypatch):
    monkeypatch.setattr(agg, "TOP_PROJECTS", 2)
    d = str(tmp_path)
    # 每条 ≈ ¥0.00006: 分桶各自四舍五入会让桶和 ≠ 总计, 不取整则严格一致
    put(d, "mbp", host_frame("mbp", [rec("c%d" % n, "2026-09-15T01:00:00Z", model="glm-5.3", project="p%d" % n, i=7 + n) for n in range(5)]))
    w = snap(d)["windows"]["month"]
    for key in ("by_project", "by_model", "by_host"):
        assert approx(sum(b["cny"] for b in w[key].values()), w["totals"]["cny"])


def test_projects_capped_with_other_bucket(tmp_path, monkeypatch):
    monkeypatch.setattr(agg, "TOP_PROJECTS", 2)
    d = str(tmp_path)
    put(d, "mbp", host_frame("mbp", [rec("p%d" % n, "2026-09-15T01:00:00Z", project="p%d" % n, o=n + 1) for n in range(4)]))
    w = snap(d)["windows"]["month"]
    assert list(w["by_project"]) == ["p3", "p2", "(其他 2 个)"]
    assert w["by_project"]["(其他 2 个)"]["total"] == 3 and w["projects_omitted"] == 2


def test_quota_block_is_self_hosted_without_numbers(tmp_path):
    q = snap(tmp_path)["quota"]
    assert q["status"] == "self_hosted" and "probed_at" in q
    assert not any(k in q for k in ("limit", "balance", "used"))


def approx(a, b):
    return abs(a - b) < 1e-9


def test_record_cny_tiers_alias_and_cache_rules():
    # glm-5.3 不分档: input 8 / cache_read 2 / output 28; cache_creation 按输入单价
    assert approx(agg.record_cny(rec("a", "", model="glm-5.3", i=1_000_000, cr=1_000_000, cc=1_000_000, o=1_000_000)), 8 + 2 + 8 + 28)
    # glm-5.1 分档边界: 上下文 31999 → [0,32K) 档; 32000 → ≥32K 档
    assert approx(agg.record_cny(rec("b", "", model="glm-5.1", i=31999)), 31999 * 6 / 1e6)
    assert approx(agg.record_cny(rec("c", "", model="glm-5.1", i=16000, cr=16000)), (16000 * 8 + 16000 * 2) / 1e6)
    # 带日期版本名按主版本计价; [1m] 客户端后缀剥掉
    assert agg.price_key("glm-5-2-260617") == ("glm-5.2", True)
    assert agg.price_key("GLM-5.3[1m]") == ("glm-5.3", False)
    assert agg.price_key("glm-9-9-260101") == (None, False)
    assert agg.record_cny(rec("d", "", model="(未知)", o=5)) is None
    # 只认 glm-<主>-<次>-<6位日期>; 其它带日期写法宁可记未定价, 不猜
    for name in ("glm-5-260617", "glm-5-turbo-260101", "glm-5-3-flash-260101", "glm-5.3-260617"):
        assert agg.price_key(name) == (None, False), name
    # 其余型号单价与分档; cache_creation 计入定档上下文
    M = 1_000_000
    assert approx(agg.record_cny(rec("e", "", model="glm-5.3-flash", i=M, cr=M, o=M)), 0.8 + 0.23 + 2.8)
    assert approx(agg.record_cny(rec("f", "", model="glm-5-turbo", i=1000, o=1000)), (1000 * 5 + 1000 * 22) / M)
    assert approx(agg.record_cny(rec("g", "", model="glm-5-turbo", i=M, o=M)), 7 + 26)
    assert approx(agg.record_cny(rec("h", "", model="glm-5", i=1000, cr=1000, o=1000)), (1000 * 4 + 1000 * 1 + 1000 * 18) / M)
    assert approx(agg.record_cny(rec("j", "", model="glm-5", i=M, cr=M, o=M)), 6 + 1.5 + 22)
    assert approx(agg.record_cny(rec("k", "", model="glm-5.1", i=1000, cc=31000)), 32000 * 8 / M)  # 1000+31000 → ≥32K 档


def test_snapshot_cny_buckets_and_pricing_block(tmp_path):
    d = str(tmp_path)
    put(d, "mbp", host_frame("mbp", [
        rec("m1", "2026-09-15T01:00:00Z", model="glm-5.3", i=500_000, cr=1_000_000, o=100_000),   # 4 + 2 + 2.8 = 8.8
        rec("m2", "2026-09-15T01:00:00Z", model="glm-5-2-260617", i=1_000_000),                   # 8
        rec("m3", "2026-09-15T01:00:00Z", model="mystery", o=1_000_000),                          # 未定价
    ]))
    s = snap(d)
    t = s["windows"]["month"]["totals"]
    assert approx(t["cny"], 16.8) and t["unpriced_msgs"] == 1 and t["msgs"] == 3
    assert approx(s["windows"]["month"]["by_model"]["glm-5.3"]["cny"], 8.8)
    assert approx(sum(b["cny"] for b in s["windows"]["month"]["by_host"].values()), t["cny"])
    p = s["pricing"]
    assert p["currency"] == "CNY" and p["source"].startswith("https://docs.bigmodel.cn/") and p["fetched_at"] == "2026-09-15"
    assert p["aliases"] == {"glm-5-2-260617": "glm-5.2"} and p["unpriced_models"] == ["mystery"]


def test_pricing_footnote_lists_only_month_window_models(tmp_path):
    d = str(tmp_path)
    put(d, "mbp", host_frame("mbp", [rec("old", "2026-08-10T01:00:00Z", model="legacy-x", o=1),
                                     rec("oldalias", "2026-08-10T01:00:00Z", model="glm-5-3-250101", o=1),
                                     rec("now", "2026-09-15T01:00:00Z", model="glm-5.3", o=1)]))
    s = snap(d)
    assert s["pricing"]["unpriced_models"] == [] and s["pricing"]["aliases"] == {}
    assert s["all_time"]["totals"]["unpriced_msgs"] == 1


def test_main_writes_atomically_with_schema(tmp_path):
    out = tmp_path / "state" / "glm-usage.json"
    out.parent.mkdir()
    assert agg.main(["--remote-dir", str(tmp_path / "remote"), "--ledger-dir", str(tmp_path / "ledger"), "--out", str(out)]) == 0
    s = json.loads(out.read_text())
    assert s["schema"] == 1 and s["kind"] == "glm-usage" and s["generated_at"].endswith("Z")
    assert [p.name for p in out.parent.iterdir()] == ["glm-usage.json"]


def test_frame_symlink_fifo_and_surrogate_rejected_per_host(tmp_path):
    remote, ledger = tmp_path / "remote", tmp_path / "ledger"
    remote.mkdir()
    ledger.mkdir()
    target = tmp_path / "elsewhere.json"
    target.write_text(json.dumps(host_frame("mbp", [rec("a", "2026-09-15T01:00:00Z", o=1)])))
    os.symlink(target, remote / "mbp.json")
    os.mkfifo(remote / "yunmai-vm.json")  # 读 FIFO 会一直阻塞: 必须在 open 之后按文件类型拒收
    put(str(remote), "box", '{"schema":1,"kind":"glm-usage-host","host":"box","generated_at":"2026-09-15T06:55:00Z",'
                            '"records":[["m\\ud800","2026-09-15T01:00:00Z","glm","p",0,0,0,4],["ok","2026-09-15T01:00:00Z","glm","p",0,0,0,2]]}')
    s = snap(remote, ledger)
    hosts = {h["host"]: h for h in s["hosts"]}
    assert "符号链接" in hosts["mbp"]["error"]
    assert "普通文件" in hosts["yunmai-vm"]["error"]
    assert hosts["box"]["ok"] is True and hosts["box"]["invalid_records"] == 1
    assert s["windows"]["month"]["totals"]["output"] == 2
    out = tmp_path / "out.json"
    agg.write_atomic(str(out), s)  # 含中文/无孤立代理项, UTF-8 输出不崩


def test_oversized_frame_rejected(tmp_path, monkeypatch):
    monkeypatch.setattr(agg, "HOST_MAX_BYTES", 100)
    put(str(tmp_path), "mbp", host_frame("mbp", [rec("a%d" % n, "2026-09-15T01:00:00Z", o=1) for n in range(20)]))
    hosts = {h["host"]: h for h in snap(tmp_path)["hosts"]}
    assert "过大" in hosts["mbp"]["error"]


def test_unreadable_ledger_aborts_publication(tmp_path):
    remote, ledger, out = tmp_path / "remote", tmp_path / "ledger", tmp_path / "glm-usage.json"
    remote.mkdir()
    ledger.mkdir()
    put(str(remote), "mbp", host_frame("mbp", [rec("a", "2026-09-15T01:00:00Z", o=1)]))
    (ledger / "mbp.json").mkdir()  # 存在但读不到(IsADirectoryError): 不能当损坏重建
    assert agg.main(["--remote-dir", str(remote), "--ledger-dir", str(ledger), "--out", str(out)]) == 1
    assert not out.exists()
    assert (ledger / "mbp.json").is_dir() and not (ledger / "mbp.json.corrupt").exists()
