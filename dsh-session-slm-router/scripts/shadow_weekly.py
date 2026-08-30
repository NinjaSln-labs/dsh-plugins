#!/usr/bin/env python3
"""
S2 影子周报统计（对照卡）— plan-b5-dsh.md Phase S2。

读取 dsh-session-slm-router 产出的影子 JSONL，计算 9 个指标，
输出一页 Markdown 报告 reports/b5-dsh-shadow-<date>.md。

用法：
    python3 scripts/shadow_weekly.py                     # 默认日志路径
    python3 scripts/shadow_weekly.py --log <path.jsonl> --out-dir <dir>

进入门槛（plan §5）：N >= 100 或 覆盖天数 >= 3；未达标时报告会标注 GATE: NOT MET。
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_LOG = Path.home() / ".dsh" / "slm-shadow" / "session-slm-shadow.jsonl"
DEFAULT_OUT_DIR = Path(__file__).resolve().parent.parent / "reports"

GATE_MIN_EVENTS = 100
GATE_MIN_DAYS = 3


def load_events(log_path: Path) -> list[dict]:
    events = []
    with log_path.open(encoding="utf-8") as f:
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                print(f"[warn] 跳过坏行 {lineno}", file=sys.stderr)
                continue
            if not isinstance(e, dict) or e.get("v") != 1:
                continue
            events.append(e)
    return events


def pct(n: int, total: int) -> str:
    return f"{(n / total * 100):.1f}%" if total else "n/a"


def p95(values: list[int]) -> str:
    if not values:
        return "n/a"
    vs = sorted(values)
    idx = max(0, round(0.95 * (len(vs) - 1)))
    return f"{vs[idx]}ms"


def coverage_days(events: list[dict]) -> int:
    days = set()
    for e in events:
        ts = e.get("ts")
        if ts:
            try:
                days.add(datetime.fromisoformat(ts.replace("Z", "+00:00")).date().isoformat())
            except ValueError:
                pass
    return len(days)


def build_report(events: list[dict], log_path: Path) -> tuple[str, bool]:
    valid = [e for e in events if e.get("predict_ok") is True]
    n = len(valid)
    gate_met = n >= GATE_MIN_EVENTS or coverage_days(events) >= GATE_MIN_DAYS

    sug_weak = sum(1 for e in valid if e.get("suggested_tier") == "weak")
    act_weak = sum(1 for e in valid if e.get("actual_tier") == "weak")
    agree = sum(1 for e in valid if e.get("agree") is True)
    to_weak = sum(1 for e in valid if e.get("switch") == "switch_to_weak")
    to_strong = sum(1 for e in valid if e.get("switch") == "switch_to_strong")
    target_unhealthy = sum(
        1 for e in valid if e.get("would_bind") is True and e.get("target_health") == "unhealthy"
    )
    abstained = sum(1 for e in valid if e.get("abstained") is True)
    ms_values = [e["predict_ms"] for e in valid if isinstance(e.get("predict_ms"), int)]
    failed = sum(1 for e in events if e.get("predict_ok") is False)

    rows = [
        ("N（有效影子条数 predict_ok=true）", str(n)),
        ("建议弱档率", f"{sug_weak}（{pct(sug_weak, n)}）"),
        ("实际弱档率", f"{act_weak}（{pct(act_weak, n)}）"),
        ("一致率 agree=true", f"{agree}（{pct(agree, n)}）"),
        ("本该换弱 switch_to_weak（省成本机会）", f"{to_weak}（{pct(to_weak, n)}）"),
        ("本该换强 switch_to_strong（质量风险·优先抽检）", f"{to_strong}（{pct(to_strong, n)}）"),
        ("目标不健康率（would_bind 且 target unhealthy）", f"{target_unhealthy}（{pct(target_unhealthy, n)}）"),
        ("弃权率 abstained=true", f"{abstained}（{pct(abstained, n)}）"),
        ("p95 predict_ms", p95(ms_values)),
    ]
    table = "| 指标 | 值 |\n|------|----|\n" + "\n".join(f"| {k} | {v} |" for k, v in rows)

    lines = [
        "# B.5 dsh 影子周报",
        "",
        f"- 生成时间：{datetime.now(timezone.utc).astimezone().isoformat(timespec='seconds')}",
        f"- 数据源：`{log_path}`（总行数 {len(events)}，其中预测失败 {failed} 条）",
        f"- 覆盖天数：{coverage_days(events)}",
        "",
        f"**GATE: {'MET' if gate_met else 'NOT MET'}**"
        f"（门槛：N≥{GATE_MIN_EVENTS} 或 天数≥{GATE_MIN_DAYS}；当前 N={n}）",
        "",
        table,
        "",
        "## 抽检建议",
        "",
    ]
    if to_strong > 0:
        lines.append(
            f"- 存在 {to_strong} 条「本该换强」——按计划优先抽检这些轮次（质量风险）。"
            "筛选命令：`grep switch_to_strong <log>` 后对照 utterance_preview。"
        )
    if to_weak > 0:
        lines.append(
            f"- 存在 {to_weak} 条「本该换弱」——省成本机会，S3 授权前仅记录。"
        )
    if n < GATE_MIN_EVENTS and not gate_met:
        lines.append(f"- 样本量不足（N={n}），本报告为中期快照，不作为 S3 授权依据。")

    lines.extend([
        "",
        "## 设计局限备注",
        "",
        "1. **单轮 utterance 限制**：R1 分类器按单轮 utterance 训练（plan-b5-dsh.md §3.2），不传会话历史。",
        "   「继续」「好」「OK」等短指令的含义依赖前文上下文，当前无法区分。",
        "   这些条不计入 S3 风险评估，由实际设计方裁决是否加上下文。",
        "",
        "2. **role=user 过滤**：过滤了 DSH 内部系统消息（goal_round/subagent report），只统计真实用户消息。",
        "",
        "## 改进建议",
        "",
        "1. **上下文继承**：对「继续」「好」「OK」等短指令，查上一轮的 `suggested_tier` 并继承，避免误判。",
        "2. **规则覆盖**：对特定 pattern（如 Background subagent 完成通知）直接 skip，不送 classifier。",
        "3. **分离表单任务**：识别 UI 表单填写类 utterance（About you/Education/Skills），可单独标记为轻量任务。",
    ])

    return "\n".join(lines) + "\n", gate_met


def main() -> int:
    ap = argparse.ArgumentParser(description="B.5 影子周报统计（S2 对照卡）")
    ap.add_argument("--log", type=Path, default=DEFAULT_LOG, help="影子 JSONL 路径")
    ap.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR, help="报告输出目录")
    args = ap.parse_args()

    if not args.log.exists():
        print(f"[error] 日志不存在：{args.log}", file=sys.stderr)
        return 2

    events = load_events(args.log)
    report, _ = build_report(events, args.log)

    date = datetime.now().strftime("%Y%m%d")
    out = args.out_dir / f"b5-dsh-shadow-{date}.md"
    args.out_dir.mkdir(parents=True, exist_ok=True)
    out.write_text(report, encoding="utf-8")

    print(f"[ok] 报告已写入 {out}")
    print(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
