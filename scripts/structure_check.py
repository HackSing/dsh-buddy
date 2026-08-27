"""结构护栏检查：增量体量红线与 CODEMAP 能力索引一致性。

设计要点（与 plan docs-harness-structure-guardrails 一致）：
- 增量优先：体量检查只对"本次改动"（工作区+暂存区+未跟踪 vs HEAD）归责，
  不扫存量，避免遗留大文件造成 WARN 疲劳；存量结构债由 structure_report 按需报告。
- 全部 WARN 级：检查负责让问题被看见，拆分与豁免的处方权留给人（体量红线自带
  "说明理由"出口）。CI --strict 下增量天然为空，仅 CODEMAP 存量一致性生效。
- git 语义：文件清单全部来自 git（untracked 遵守 .gitignore），不建目录排除清单；
  非 git 目标 checked=0 跳过，与 ScriptHygiene 同口径。
- 函数级检查仅覆盖 Python（标准库 ast，零依赖）；其他语言只做文件级净增检查。
  HEAD 版本或当前版本解析失败时跳过该文件的函数级判定，文件级仍执行。
"""

from __future__ import annotations

import ast
import re
import subprocess
from pathlib import Path
from typing import Any

FILE_RED_LINE = 500
FUNC_RED_LINE = 60
OVERSIZE_FILE_GROWTH_ALERT = 50
FUNC_GROWTH_ALERT = 10
CODEMAP_RELATIVE = "docs/CODEMAP.md"
CODE_SUFFIXES = frozenset({
    ".py", ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".vue", ".go", ".rs",
    ".java", ".kt", ".swift", ".c", ".h", ".cc", ".cpp", ".hpp", ".cs", ".rb",
    ".php", ".lua",
})
_TEST_FILE_HINTS = ("test_", "_test.", ".test.", ".spec.")
_CODEMAP_ENTRY_PATTERN = re.compile(r"^\s*-\s*`([^`]+)`")

CODEMAP_SCAFFOLD = """# CODEMAP：代码能力索引

动手写代码前先查本索引定位可复用模块；新增代码文件或公开接口变化时同步更新条目。
每行一个模块，格式如下（登记时去掉行首的"示例："）：

示例：- `src/example/module.py` — 职责：一句话说明；公开接口：`main_function`、`ExampleClass`

Structure 检查会校验登记路径存在、公开接口符号存活，并提醒未登记的新增代码文件；
测试文件不必登记。
"""


def _git(target: Path, *args: str) -> subprocess.CompletedProcess | None:
    try:
        return subprocess.run(
            ["git", *args], cwd=target, capture_output=True, check=False
        )
    except OSError:
        return None


def _is_code_file(relative: str) -> bool:
    return Path(relative).suffix.lower() in CODE_SUFFIXES


def _is_test_file(relative: str) -> bool:
    parts = [part.lower() for part in Path(relative).parts]
    if any(part in ("tests", "test", "__tests__") for part in parts[:-1]):
        return True
    return any(hint in parts[-1] for hint in _TEST_FILE_HINTS)


def _zsplit(stdout: bytes) -> list[str]:
    return [raw.decode("utf-8", errors="replace") for raw in stdout.split(b"\0") if raw]


def _untracked_files(target: Path) -> list[str]:
    result = _git(target, "ls-files", "--others", "--exclude-standard", "-z")
    if result is None or result.returncode != 0:
        return []
    return _zsplit(result.stdout)


def _changed_code_files(target: Path) -> dict[str, str] | None:
    """本次改动的代码文件：{相对路径: "A"|"M"}；非 git 仓库返回 None。

    对比基线是 HEAD（含暂存与未暂存），未跟踪文件按新增计；空仓（无 HEAD）时
    全部 tracked+untracked 代码文件按新增处理。
    """
    probe = _git(target, "rev-parse", "--is-inside-work-tree")
    if probe is None or probe.returncode != 0:
        return None
    changed: dict[str, str] = {}
    head = _git(target, "rev-parse", "--verify", "HEAD")
    if head is not None and head.returncode == 0:
        diff = _git(target, "diff", "HEAD", "--name-status", "--no-renames", "-z")
        if diff is not None and diff.returncode == 0:
            tokens = _zsplit(diff.stdout)
            for status, relative in zip(tokens[::2], tokens[1::2]):
                if status.startswith("D"):
                    continue
                changed[relative] = "A" if status.startswith("A") else "M"
    else:
        tracked = _git(target, "ls-files", "-z")
        if tracked is not None and tracked.returncode == 0:
            changed.update({relative: "A" for relative in _zsplit(tracked.stdout)})
    changed.update({relative: "A" for relative in _untracked_files(target)})
    return {
        relative: status
        for relative, status in changed.items()
        if _is_code_file(relative) and (target / relative).is_file()
    }


def _line_count(text: str) -> int:
    return len(text.splitlines())


def _read_current(target: Path, relative: str) -> str:
    return (target / relative).read_text(encoding="utf-8", errors="replace")


def _read_head(target: Path, relative: str) -> str | None:
    result = _git(target, "show", f"HEAD:{relative}")
    if result is None or result.returncode != 0:
        return None
    return result.stdout.decode("utf-8", errors="replace")


def _python_functions(source: str) -> dict[str, int] | None:
    """函数限定名 -> 行数（def 行到结尾）；语法错误返回 None。同名取最大值。"""
    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError):
        return None
    spans: dict[str, int] = {}

    def visit(node: ast.AST, prefix: str) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                name = f"{prefix}{child.name}"
                span = (child.end_lineno or child.lineno) - child.lineno + 1
                spans[name] = max(spans.get(name, 0), span)
                visit(child, f"{name}.")
            elif isinstance(child, ast.ClassDef):
                visit(child, f"{prefix}{child.name}.")
            else:
                visit(child, prefix)

    visit(tree, "")
    return spans


def _file_size_warnings(relative: str, status: str, current: str, head: str | None) -> list[str]:
    lines = _line_count(current)
    if status == "A" or head is None:
        if lines > FILE_RED_LINE:
            return [
                f"新增文件 {relative} 共 {lines} 行，超过 {FILE_RED_LINE} 行红线，"
                "按职责拆分或在收尾报告说明不可拆的理由"
            ]
        return []
    old_lines = _line_count(head)
    growth = lines - old_lines
    if old_lines <= FILE_RED_LINE < lines:
        return [
            f"{relative} 本次净增 {growth} 行（{old_lines}→{lines}），"
            f"突破 {FILE_RED_LINE} 行红线，按职责拆分或说明理由"
        ]
    if old_lines > FILE_RED_LINE and growth >= OVERSIZE_FILE_GROWTH_ALERT:
        return [
            f"{relative} 已超 {FILE_RED_LINE} 行红线仍净增 {growth} 行"
            f"（{old_lines}→{lines}），优先把新增逻辑落到独立模块"
        ]
    return []


def _function_warnings(relative: str, current: str, head: str | None) -> list[str]:
    if Path(relative).suffix.lower() != ".py":
        return []
    spans = _python_functions(current)
    if spans is None:
        return []
    old_spans = _python_functions(head) if head is not None else {}
    if old_spans is None:
        return []
    warnings: list[str] = []
    for name, span in sorted(spans.items()):
        if span <= FUNC_RED_LINE:
            continue
        old_span = old_spans.get(name)
        if old_span is None:
            warnings.append(
                f"{relative} 新增函数 {name} 共 {span} 行，"
                f"超过 {FUNC_RED_LINE} 行红线，拆出子步骤或说明理由"
            )
        elif span - old_span >= FUNC_GROWTH_ALERT:
            warnings.append(
                f"{relative} 函数 {name} 本次增长 {span - old_span} 行"
                f"（{old_span}→{span}），已超 {FUNC_RED_LINE} 行红线，停止继续膨胀"
            )
    return warnings


def parse_codemap(text: str) -> list[tuple[str, list[str]]]:
    """解析 CODEMAP 条目行：`- `路径` — 职责：…；公开接口：`sym`…`；不匹配的行忽略。"""
    entries: list[tuple[str, list[str]]] = []
    for line in text.splitlines():
        match = _CODEMAP_ENTRY_PATTERN.match(line)
        if not match:
            continue
        _, _, interface_part = line.partition("公开接口")
        symbols = re.findall(r"`([^`]+)`", interface_part)
        entries.append((match.group(1), symbols))
    return entries


def _codemap_consistency_warnings(target: Path, entries: list[tuple[str, list[str]]]) -> list[str]:
    warnings: list[str] = []
    for module_path, symbols in entries:
        path = target / module_path
        if not path.is_file():
            warnings.append(
                f"CODEMAP 登记的模块不存在：{module_path}，更新或移除该条目"
            )
            continue
        content = path.read_text(encoding="utf-8", errors="replace")
        for symbol in symbols:
            if symbol not in content:
                warnings.append(
                    f"CODEMAP 中 {module_path} 的公开接口 `{symbol}` "
                    "在源码中不存在，索引已失活，同步更新条目"
                )
    return warnings


def _codemap_registration_warnings(
    changed: dict[str, str], entries: list[tuple[str, list[str]]]
) -> list[str]:
    registered = {module_path for module_path, _ in entries}
    return [
        f"新增代码文件 {relative} 未登记 {CODEMAP_RELATIVE}"
        "（模块路径 — 职责 — 公开接口），登记后复用才可被发现"
        for relative, status in sorted(changed.items())
        if status == "A" and not _is_test_file(relative) and relative not in registered
    ]


def check_structure(target: Path) -> dict[str, Any]:
    """assets-check 第六 checker：增量体量 + CODEMAP 一致性，全部 WARN 级。"""
    changed = _changed_code_files(target)
    if changed is None:
        return {"status": "passed", "failures": [], "warnings": [], "checked": 0}
    warnings: list[str] = []
    for relative, status in sorted(changed.items()):
        current = _read_current(target, relative)
        head = _read_head(target, relative) if status == "M" else None
        warnings.extend(_file_size_warnings(relative, status, current, head))
        warnings.extend(_function_warnings(relative, current, head))
    checked = len(changed)
    codemap_path = target / CODEMAP_RELATIVE
    if codemap_path.is_file():
        entries = parse_codemap(codemap_path.read_text(encoding="utf-8", errors="replace"))
        warnings.extend(_codemap_consistency_warnings(target, entries))
        warnings.extend(_codemap_registration_warnings(changed, entries))
        checked += len(entries)
    return {"status": "passed", "failures": [], "warnings": warnings, "checked": checked}


def _stock_code_files(target: Path) -> list[str] | None:
    tracked = _git(target, "ls-files", "-z")
    if tracked is None or tracked.returncode != 0:
        return None
    files = _zsplit(tracked.stdout) + _untracked_files(target)
    return sorted(
        relative
        for relative in dict.fromkeys(files)
        if _is_code_file(relative) and (target / relative).is_file()
    )


def structure_report(target: Path) -> dict[str, Any]:
    """存量结构债报告：超红线文件/函数 + CODEMAP 覆盖缺口，供定期整理任务使用。"""
    files = _stock_code_files(target)
    if files is None:
        return {"status": "skipped", "reason": "目标不是 git 仓库，无法枚举代码文件"}
    oversized_files: list[dict[str, Any]] = []
    oversized_functions: list[dict[str, Any]] = []
    for relative in files:
        content = _read_current(target, relative)
        lines = _line_count(content)
        if lines > FILE_RED_LINE:
            oversized_files.append({"path": relative, "lines": lines})
        if Path(relative).suffix.lower() == ".py":
            spans = _python_functions(content) or {}
            for name, span in sorted(spans.items()):
                if span > FUNC_RED_LINE:
                    oversized_functions.append(
                        {"path": relative, "function": name, "lines": span}
                    )
    codemap_path = target / CODEMAP_RELATIVE
    entries = (
        parse_codemap(codemap_path.read_text(encoding="utf-8", errors="replace"))
        if codemap_path.is_file()
        else []
    )
    registered = {module_path for module_path, _ in entries}
    unregistered = [
        relative for relative in files
        if not _is_test_file(relative) and relative not in registered
    ]
    return {
        "status": "ok",
        "checked": len(files),
        "file_red_line": FILE_RED_LINE,
        "func_red_line": FUNC_RED_LINE,
        "files_over_red_line": oversized_files,
        "functions_over_red_line": oversized_functions,
        "codemap": {
            "present": codemap_path.is_file(),
            "entries": len(entries),
            "dead_entry_warnings": _codemap_consistency_warnings(target, entries),
            "unregistered_files": unregistered,
        },
        "summary": (
            f"structure report：代码文件 {len(files)} 个，超红线文件 {len(oversized_files)} 个、"
            f"超红线函数 {len(oversized_functions)} 个、未登记 CODEMAP {len(unregistered)} 个"
        ),
    }
