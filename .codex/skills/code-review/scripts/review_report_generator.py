#!/usr/bin/env python3
"""Generate a markdown review scaffold from analyzer outputs."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any


def run_json(cmd: list[str], cwd: Path) -> dict[str, Any]:
    result = subprocess.run(
        cmd,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"command failed: {' '.join(cmd)}")

    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f'failed to parse JSON output: {error}') from error


def get_repo_root(target: str) -> Path:
    start = Path(target).resolve()
    if start.is_file():
        start = start.parent

    result = subprocess.run(
        ['git', 'rev-parse', '--show-toplevel'],
        cwd=start,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or 'unable to determine git repository root')

    return Path(result.stdout.strip())


def severity_rank(severity: str) -> int:
    order = {'high': 0, 'medium': 1, 'low': 2}
    return order.get(severity, 3)


def build_markdown(analyzer: dict[str, Any], checker: dict[str, Any]) -> str:
    changed_files = analyzer.get('changed_files', [])
    findings = checker.get('findings', [])
    findings = sorted(findings, key=lambda item: (severity_rank(item.get('severity', 'low')), item.get('file', '')))

    lines: list[str] = []
    lines.append('# Review Report')
    lines.append('')
    lines.append('## Scope')
    lines.append(f"- Diff: `{analyzer.get('diff_mode', 'unknown')}`")
    lines.append(f"- Risk level: `{analyzer.get('risk_level', 'unknown')}`")
    lines.append(f"- Changed files: `{analyzer.get('changed_file_count', 0)}`")

    if changed_files:
        lines.append('')
        lines.append('### Files')
        for file_path in changed_files:
            lines.append(f'- `{file_path}`')

    lines.append('')
    lines.append('## Findings')
    if findings:
        for finding in findings:
            severity = finding.get('severity', 'low').upper()
            title = finding.get('title', 'Issue')
            file_path = finding.get('file', 'unknown')
            line = finding.get('line', 1)
            detail = finding.get('detail', '').strip()
            lines.append(f"- [{severity}] {title} (`{file_path}:{line}`)")
            if detail:
                lines.append(f"  - {detail}")
    else:
        lines.append('- No automated findings. Manual review still required.')

    lines.append('')
    lines.append('## Recommended Verification')
    checks = analyzer.get('recommended_checks', [])
    if checks:
        for check in checks:
            lines.append(f'- `{check}`')
    else:
        lines.append('- None')

    notes = analyzer.get('notes', [])
    if notes:
        lines.append('')
        lines.append('## Notes')
        for note in notes:
            lines.append(f'- {note}')

    lines.append('')
    lines.append('## Codex Response Template')
    lines.append('1. Findings first, ordered by severity.')
    lines.append('2. Include absolute file references with line numbers.')
    lines.append('3. Add test gaps and residual risks after findings.')
    lines.append('4. If requested, emit one `::code-comment{...}` per finding.')

    return '\n'.join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Generate markdown review report scaffold.')
    parser.add_argument('--target', default='.', help='Repository path or file inside repo.')
    parser.add_argument('--base', default='origin/main', help='Base ref for changed-file scan.')
    parser.add_argument('--head', default='HEAD', help='Head ref for changed-file scan.')
    parser.add_argument('--staged', action='store_true', help='Use staged files only.')
    parser.add_argument('--include-untracked', action='store_true', help='Include untracked files.')
    parser.add_argument('--output', help='Write markdown to this path instead of stdout.')
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        repo_root = get_repo_root(args.target)
        script_dir = Path(__file__).resolve().parent

        analyzer_cmd = [
            sys.executable,
            str(script_dir / 'pr_analyzer.py'),
            '--target',
            str(repo_root),
            '--base',
            args.base,
            '--head',
            args.head,
            '--json',
        ]
        checker_cmd = [
            sys.executable,
            str(script_dir / 'code_quality_checker.py'),
            '--target',
            str(repo_root),
            '--base',
            args.base,
            '--head',
            args.head,
            '--json',
        ]

        if args.staged:
            analyzer_cmd.append('--staged')
            checker_cmd.append('--staged')
        if args.include_untracked:
            analyzer_cmd.append('--include-untracked')
            checker_cmd.append('--include-untracked')

        analyzer = run_json(analyzer_cmd, repo_root)
        checker = run_json(checker_cmd, repo_root)
        report = build_markdown(analyzer, checker)

        if args.output:
            output_path = Path(args.output)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(report, encoding='utf-8')
            print(f'Wrote report to {output_path}')
        else:
            print(report)

        return 0
    except RuntimeError as error:
        print(f'error: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
