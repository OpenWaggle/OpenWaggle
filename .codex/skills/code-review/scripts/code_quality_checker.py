#!/usr/bin/env python3
"""Run project-specific static guardrail checks for code review."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

NUMERIC_LITERAL_RE = re.compile(r'(?<![A-Za-z0-9_])-?\d[\d_]*(?:\.\d+)?')
SCREAMING_SNAKE_RE = re.compile(r'\b[A-Z][A-Z0-9_]*\b')
WHITESPACE_RE = re.compile(r'\s+')
CONSTANT_DECLARATION_RE = re.compile(r'^(?:export\s+)?const\s+[A-Z][A-Z0-9_]*\s*=')
LITERAL_PLACEHOLDER = '__lit__'
MAX_SOURCE_FILES_FOR_MISSING_TESTS_HEURISTIC = 25


def run(cmd: list[str], cwd: Path) -> str:
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
    return result.stdout.strip()


def command_succeeds(cmd: list[str], cwd: Path) -> bool:
    result = subprocess.run(
        cmd,
        cwd=cwd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
        check=False,
    )
    return result.returncode == 0


def run_optional(cmd: list[str], cwd: Path) -> str:
    result = subprocess.run(
        cmd,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return ''
    return result.stdout.strip()


def get_repo_root(target: str) -> Path:
    start = Path(target).resolve()
    if start.is_file():
        start = start.parent
    output = run(['git', 'rev-parse', '--show-toplevel'], start)
    return Path(output)


def changed_files(repo_root: Path, base: str, head: str, staged: bool) -> list[str]:
    if staged:
        output = run(['git', 'diff', '--cached', '--name-only'], repo_root)
        return [line for line in output.splitlines() if line]

    files: list[str] = []

    if base and command_succeeds(['git', 'rev-parse', '--verify', '--quiet', base], repo_root):
        output = run(['git', 'diff', '--name-only', f'{base}...{head}'], repo_root)
        files.extend(line for line in output.splitlines() if line)
    else:
        fallback_ranges = [
            ['git', 'diff', '--name-only', f'{head}~1', head],
            ['git', 'diff', '--name-only', head],
        ]

        for cmd in fallback_ranges:
            if command_succeeds(cmd, repo_root):
                output = run(cmd, repo_root)
                files.extend(line for line in output.splitlines() if line)
                break

    local_tracked_output = run(['git', 'diff', '--name-only'], repo_root)
    local_staged_output = run(['git', 'diff', '--cached', '--name-only'], repo_root)
    files.extend(
        line
        for line in (
            local_tracked_output.splitlines() + local_staged_output.splitlines()
        )
        if line
    )

    return sorted(set(files))


def collect_file_diff(repo_root: Path, base: str, head: str, file_path: str) -> str:
    segments: list[str] = []

    if base and command_succeeds(['git', 'rev-parse', '--verify', '--quiet', base], repo_root):
        segments.append(
            run_optional(['git', 'diff', '--unified=0', f'{base}...{head}', '--', file_path], repo_root)
        )
    else:
        fallback_ranges = [
            ['git', 'diff', '--unified=0', f'{head}~1', head, '--', file_path],
            ['git', 'diff', '--unified=0', head, '--', file_path],
        ]
        for cmd in fallback_ranges:
            output = run_optional(cmd, repo_root)
            if output:
                segments.append(output)
                break

    segments.append(run_optional(['git', 'diff', '--unified=0', '--', file_path], repo_root))
    segments.append(run_optional(['git', 'diff', '--unified=0', '--cached', '--', file_path], repo_root))

    return '\n'.join(segment for segment in segments if segment)


def tracked_files(repo_root: Path) -> list[str]:
    output = run(['git', 'ls-files'], repo_root)
    return [line for line in output.splitlines() if line]


def untracked_files(repo_root: Path) -> list[str]:
    output = run(['git', 'ls-files', '--others', '--exclude-standard'], repo_root)
    return [line for line in output.splitlines() if line]


def read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding='utf-8')
    except (UnicodeDecodeError, OSError):
        return None


def is_scan_target(path: str) -> bool:
    return path.endswith(
        (
            '.ts',
            '.tsx',
            '.js',
            '.jsx',
            '.mjs',
            '.cjs',
            '.mts',
            '.cts',
        )
    )


def find_line(text: str, pattern: re.Pattern[str]) -> int:
    for index, line in enumerate(text.splitlines(), start=1):
        if pattern.search(line):
            return index
    return 1


def add_finding(
    findings: list[dict[str, Any]],
    severity: str,
    file_path: str,
    line: int,
    title: str,
    detail: str,
) -> None:
    findings.append(
        {
            'severity': severity,
            'file': file_path,
            'line': line,
            'title': title,
            'detail': detail,
        }
    )


def is_ignorable_diff_line(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return True
    if stripped.startswith(('import ', '//', '/*', '*', '*/')):
        return True
    if stripped.startswith('type ') or stripped.startswith('export type '):
        return True
    if CONSTANT_DECLARATION_RE.match(stripped):
        return True
    return False


def canonicalize_diff_line(line: str) -> str:
    normalized = NUMERIC_LITERAL_RE.sub(LITERAL_PLACEHOLDER, line)
    normalized = SCREAMING_SNAKE_RE.sub(LITERAL_PLACEHOLDER, normalized)
    normalized = WHITESPACE_RE.sub('', normalized)
    return normalized


def is_constant_extraction_only_change(repo_root: Path, base: str, head: str, file_path: str) -> bool:
    diff_text = collect_file_diff(repo_root, base, head, file_path)
    if not diff_text:
        return False

    removed_lines: list[str] = []
    added_lines: list[str] = []

    for line in diff_text.splitlines():
        if line.startswith(('+++', '---', '@@', 'diff --git', 'index ')):
            continue
        if line.startswith('-'):
            removed_lines.append(line[1:])
        elif line.startswith('+'):
            added_lines.append(line[1:])

    filtered_removed = [line for line in removed_lines if not is_ignorable_diff_line(line)]
    filtered_added = [line for line in added_lines if not is_ignorable_diff_line(line)]

    if not filtered_removed and not filtered_added:
        return True

    removed_signature = ''.join(canonicalize_diff_line(line) for line in filtered_removed)
    added_signature = ''.join(canonicalize_diff_line(line) for line in filtered_added)
    return removed_signature == added_signature


def check_file(repo_root: Path, file_path: str, findings: list[dict[str, Any]]) -> None:
    normalized = file_path.replace('\\', '/')

    if normalized == 'src/routeTree.gen.ts' or normalized.startswith('convex/_generated/'):
        add_finding(
            findings,
            'high',
            normalized,
            1,
            'Generated file modified',
            'Generated artifacts should not be edited manually.',
        )
        return

    if not is_scan_target(normalized):
        return

    content = read_text(repo_root / normalized)
    if content is None:
        return

    if 'useMemo(' in content:
        add_finding(
            findings,
            'medium',
            normalized,
            find_line(content, re.compile(r'\buseMemo\s*\(')),
            'Manual memoization detected',
            'React Compiler is enabled; avoid useMemo unless justified by measured performance evidence.',
        )

    if 'useCallback(' in content:
        add_finding(
            findings,
            'medium',
            normalized,
            find_line(content, re.compile(r'\buseCallback\s*\(')),
            'Manual callback memoization detected',
            'React Compiler is enabled; avoid useCallback unless a specific interoperability case requires it.',
        )

    if 'React.memo(' in content:
        add_finding(
            findings,
            'medium',
            normalized,
            find_line(content, re.compile(r'React\.memo\s*\(')),
            'React.memo detected',
            'Prefer compiler-driven optimization instead of React.memo by default.',
        )

    env_pattern = re.compile(r'import\.meta\.env\.[A-Z0-9_]+')
    if env_pattern.search(content) and normalized != 'src/env.ts':
        add_finding(
            findings,
            'medium',
            normalized,
            find_line(content, env_pattern),
            'Direct import.meta.env usage',
            'Use validated environment accessors from @/env instead of raw import.meta.env.',
        )

    if normalized.startswith('src/'):
        process_env_pattern = re.compile(r'\bprocess\.env\.[A-Z0-9_]+')
        if process_env_pattern.search(content):
            add_finding(
                findings,
                'medium',
                normalized,
                find_line(content, process_env_pattern),
                'process.env in client-side source',
                'Client/runtime code should not read process.env directly.',
            )

    as_any_pattern = re.compile(r'\bas any\b')
    if as_any_pattern.search(content):
        add_finding(
            findings,
            'low',
            normalized,
            find_line(content, as_any_pattern),
            'Type escape hatch (`as any`) detected',
            'Prefer explicit typing/refinement over `as any` to preserve strict TypeScript guarantees.',
        )

    if normalized.startswith('e2e/') and 'networkidle' in content:
        add_finding(
            findings,
            'medium',
            normalized,
            find_line(content, re.compile(r'networkidle')),
            'Playwright networkidle wait detected',
            'Convex keeps a websocket open; networkidle can be flaky. Prefer domcontentloaded or explicit UI assertions.',
        )


def check_missing_tests(
    repo_root: Path,
    files: list[str],
    base: str,
    head: str,
    findings: list[dict[str, Any]],
) -> None:
    source_changes = [
        path
        for path in files
        if (path.startswith('src/') or path.startswith('convex/'))
        and '.test.' not in path
        and not path.startswith('e2e/')
        and path.endswith(('.ts', '.tsx', '.js', '.jsx'))
    ]
    test_changes = [
        path
        for path in files
        if '.test.' in path or path.endswith('.spec.ts') or path.endswith('.spec.tsx') or path.startswith('e2e/')
    ]

    # Large refactors (for example repository-wide constant extraction) create too much noise
    # for this heuristic and routinely produce false positives.
    if len(source_changes) > MAX_SOURCE_FILES_FOR_MISSING_TESTS_HEURISTIC:
        return

    behavioral_changes = [
        path
        for path in source_changes
        if not is_constant_extraction_only_change(repo_root, base, head, path)
    ]

    if behavioral_changes and not test_changes:
        add_finding(
            findings,
            'medium',
            behavioral_changes[0],
            1,
            'Behavioral code changed without test file updates',
            'Add or update tests for changed behavior, or document why existing coverage is sufficient.',
        )


def severity_weight(severity: str) -> int:
    order = {'high': 0, 'medium': 1, 'low': 2}
    return order.get(severity, 3)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Run static guardrail checks for review.')
    parser.add_argument('--target', default='.', help='Repository path or file inside repo.')
    parser.add_argument('--base', default='origin/main', help='Base ref for changed-file scan.')
    parser.add_argument('--head', default='HEAD', help='Head ref for changed-file scan.')
    parser.add_argument('--staged', action='store_true', help='Scan staged files only.')
    parser.add_argument('--all-files', action='store_true', help='Scan all tracked files.')
    parser.add_argument('--include-untracked', action='store_true', help='Include untracked files.')
    parser.add_argument('--json', action='store_true', help='Print output as JSON.')
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        repo_root = get_repo_root(args.target)

        if args.all_files:
            files = tracked_files(repo_root)
        else:
            files = changed_files(repo_root, args.base, args.head, args.staged)

        if args.include_untracked:
            files = sorted(set(files + untracked_files(repo_root)))

        findings: list[dict[str, Any]] = []
        for file_path in sorted(set(files)):
            check_file(repo_root, file_path, findings)

        check_missing_tests(repo_root, files, args.base, args.head, findings)
        findings.sort(key=lambda item: (severity_weight(item['severity']), item['file'], item['line']))

        report: dict[str, Any] = {
            'repo_root': str(repo_root),
            'scanned_file_count': len(sorted(set(files))),
            'findings': findings,
            'summary': {
                'high': sum(1 for item in findings if item['severity'] == 'high'),
                'medium': sum(1 for item in findings if item['severity'] == 'medium'),
                'low': sum(1 for item in findings if item['severity'] == 'low'),
            },
        }

        if args.json:
            print(json.dumps(report, indent=2))
        else:
            print('Code Quality Checker')
            print('=' * 40)
            print(f"Scanned files: {report['scanned_file_count']}")
            print(
                'Findings: '
                f"high={report['summary']['high']} "
                f"medium={report['summary']['medium']} "
                f"low={report['summary']['low']}"
            )
            if findings:
                print('\nDetails:')
                for finding in findings:
                    print(
                        f"- [{finding['severity'].upper()}] {finding['title']} "
                        f"({finding['file']}:{finding['line']})"
                    )
                    print(f"  {finding['detail']}")
            else:
                print('No static guardrail findings.')

        return 0
    except RuntimeError as error:
        print(f'error: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
