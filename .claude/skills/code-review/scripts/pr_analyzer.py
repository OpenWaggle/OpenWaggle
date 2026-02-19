#!/usr/bin/env python3
"""Analyze changed files and suggest review/test scope for any git repository."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any


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


def get_repo_root(target: str) -> Path:
    start = Path(target).resolve()
    if start.is_file():
        start = start.parent
    output = run(['git', 'rev-parse', '--show-toplevel'], start)
    return Path(output)


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


def diff_files(repo_root: Path, base: str, head: str, staged: bool) -> tuple[list[str], str]:
    if staged:
        output = run(['git', 'diff', '--cached', '--name-only'], repo_root)
        files = [line for line in output.splitlines() if line]
        return files, 'staged'

    files: list[str] = []
    diff_mode_parts: list[str] = []

    if base and command_succeeds(['git', 'rev-parse', '--verify', '--quiet', base], repo_root):
        output = run(['git', 'diff', '--name-only', f'{base}...{head}'], repo_root)
        files.extend(line for line in output.splitlines() if line)
        diff_mode_parts.append(f'{base}...{head}')
    else:
        fallback_ranges = [
            ['git', 'diff', '--name-only', f'{head}~1', head],
            ['git', 'diff', '--name-only', head],
        ]
        for cmd in fallback_ranges:
            if command_succeeds(cmd, repo_root):
                output = run(cmd, repo_root)
                files.extend(line for line in output.splitlines() if line)
                diff_mode_parts.append('fallback')
                break

    local_tracked_output = run(['git', 'diff', '--name-only'], repo_root)
    local_staged_output = run(['git', 'diff', '--cached', '--name-only'], repo_root)
    local_files = [
        line
        for line in (local_tracked_output.splitlines() + local_staged_output.splitlines())
        if line
    ]
    if local_files:
        files.extend(local_files)
        diff_mode_parts.append('working-tree')

    return sorted(set(files)), ' + '.join(diff_mode_parts) if diff_mode_parts else 'none'


def untracked_files(repo_root: Path) -> list[str]:
    output = run(['git', 'ls-files', '--others', '--exclude-standard'], repo_root)
    return [line for line in output.splitlines() if line]


def load_package_scripts(repo_root: Path) -> dict[str, str]:
    package_json = repo_root / 'package.json'
    if not package_json.exists():
        return {}

    try:
        payload = json.loads(package_json.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return {}

    scripts = payload.get('scripts', {})
    if isinstance(scripts, dict):
        return {str(key): str(value) for key, value in scripts.items()}
    return {}


def detect_package_manager(repo_root: Path) -> str:
    if (repo_root / 'pnpm-lock.yaml').exists():
        return 'pnpm'
    if (repo_root / 'bun.lockb').exists() or (repo_root / 'bun.lock').exists():
        return 'bun'
    if (repo_root / 'yarn.lock').exists():
        return 'yarn'
    if (repo_root / 'package-lock.json').exists() or (repo_root / 'package.json').exists():
        return 'npm'
    return 'unknown'


def run_script_command(package_manager: str, script_name: str) -> str:
    if package_manager == 'pnpm':
        return f'pnpm {script_name}'
    if package_manager == 'yarn':
        return f'yarn {script_name}'
    if package_manager == 'bun':
        return f'bun run {script_name}'
    if package_manager == 'npm':
        return f'npm run {script_name}'
    return f'<run {script_name}>'


def is_doc_file(path: str) -> bool:
    return (
        path.startswith('docs/')
        or path.endswith(('.md', '.mdx', '.rst', '.adoc', '.txt'))
        or path in {'AGENTS.md', 'CODEX.md', 'CLAUDE.md', 'LEARNINGS.md', 'README.md', 'progress.txt'}
    )


def is_test_file(path: str) -> bool:
    return (
        '.test.' in path
        or '.spec.' in path
        or path.startswith(('test/', 'tests/', '__tests__/', 'e2e/', 'cypress/'))
    )


def classify(files: list[str]) -> dict[str, bool]:
    checks = {
        'touches_frontend': False,
        'touches_backend': False,
        'touches_shared': False,
        'touches_tests': False,
        'touches_e2e': False,
        'touches_docs': False,
        'touches_config': False,
        'touches_auth': False,
        'touches_data': False,
        'touches_ci': False,
    }

    config_files = {
        'package.json',
        'package-lock.json',
        'pnpm-lock.yaml',
        'yarn.lock',
        'bun.lockb',
        'bun.lock',
        'tsconfig.json',
        'biome.json',
        '.eslintrc',
        '.eslintrc.js',
        '.eslintrc.cjs',
        '.eslintrc.json',
        '.prettierrc',
        '.prettierrc.json',
        '.prettierrc.js',
        'vite.config.ts',
        'vitest.config.ts',
        'playwright.config.ts',
        'jest.config.ts',
        'jest.config.js',
    }

    for file_path in files:
        path = file_path.replace('\\', '/')
        lower = path.lower()
        basename = Path(path).name.lower()

        if path.startswith(('src/', 'app/', 'web/', 'frontend/', 'client/')):
            checks['touches_frontend'] = True

        if path.startswith(('api/', 'server/', 'backend/', 'services/', 'workers/', 'jobs/', 'functions/', 'convex/')):
            checks['touches_backend'] = True

        if path.startswith(('shared/', 'lib/', 'utils/', 'packages/')) or path.startswith(('src/lib/', 'src/hooks/')):
            checks['touches_shared'] = True

        if path.startswith(('e2e/', 'cypress/', 'playwright/')):
            checks['touches_e2e'] = True
            checks['touches_tests'] = True

        if is_test_file(path):
            checks['touches_tests'] = True

        if is_doc_file(path):
            checks['touches_docs'] = True

        if path in config_files or basename.endswith(('.config.ts', '.config.js', '.config.cjs', '.config.mjs')):
            checks['touches_config'] = True

        if path.startswith(('.github/workflows/', '.circleci/', '.buildkite/')):
            checks['touches_ci'] = True

        auth_tokens = ('auth', 'session', 'token', 'oauth', 'sso', 'rbac', 'permission', 'acl', 'webhook')
        if any(token in lower for token in auth_tokens):
            checks['touches_auth'] = True

        data_tokens = ('schema', 'migration', 'migrations', 'prisma', 'sql', 'database', 'db', 'model', 'seed')
        if any(token in lower for token in data_tokens):
            checks['touches_data'] = True

    checks['docs_only'] = bool(files) and all(is_doc_file(file_path) for file_path in files)
    return checks


def risk_level(classes: dict[str, bool]) -> str:
    if classes.get('docs_only'):
        return 'low'

    score = 0
    if classes['touches_auth']:
        score += 2
    if classes['touches_data']:
        score += 2
    if classes['touches_backend']:
        score += 1
    if classes['touches_frontend']:
        score += 1
    if classes['touches_config']:
        score += 1
    if classes['touches_ci']:
        score += 1

    if score >= 5:
        return 'high'
    if score >= 3:
        return 'medium'
    return 'low'


def recommend_checks(
    classes: dict[str, bool],
    risk: str,
    files: list[str],
    scripts: dict[str, str],
    package_manager: str,
) -> tuple[list[str], list[str]]:
    notes: list[str] = []

    if not files:
        return ['No changed files detected.'], notes

    if classes['docs_only']:
        return ['No mandatory tests (docs-only change).'], notes

    checks: list[str] = []
    code_change_exists = any(
        path.endswith(('.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java'))
        and not is_test_file(path)
        for path in files
    )

    if code_change_exists and 'test' in scripts:
        checks.append(run_script_command(package_manager, 'test'))

    if code_change_exists and 'typecheck' in scripts:
        checks.append(run_script_command(package_manager, 'typecheck'))

    if classes['touches_config']:
        if 'check' in scripts:
            checks.append(run_script_command(package_manager, 'check'))
        elif 'lint' in scripts:
            checks.append(run_script_command(package_manager, 'lint'))
        notes.append('Config/build files changed. Validate affected flows manually.')

    if (classes['touches_frontend'] or classes['touches_e2e']) and risk in {'medium', 'high'}:
        if 'test:e2e' in scripts:
            checks.append(f"{run_script_command(package_manager, 'test:e2e')} (targeted affected flow)")
        elif 'e2e' in scripts:
            checks.append(f"{run_script_command(package_manager, 'e2e')} (targeted affected flow)")
        else:
            notes.append('No explicit E2E script detected. Run the project UI-flow verification command if available.')

    if 'codex:preflight' in scripts:
        checks.append(run_script_command(package_manager, 'codex:preflight'))

    if code_change_exists and not classes['touches_tests']:
        notes.append('Behavioral code changed without test file changes; confirm coverage is sufficient.')

    if classes['touches_ci']:
        notes.append('CI workflow files changed; verify checks still run as expected.')

    if not checks:
        checks.append('Run the project test/typecheck/lint commands for the touched areas.')

    deduped: list[str] = []
    for check in checks:
        if check not in deduped:
            deduped.append(check)

    return deduped, notes


def build_report(repo_root: Path, files: list[str], base: str, head: str, diff_mode: str) -> dict[str, Any]:
    classes = classify(files)
    risk = risk_level(classes)
    scripts = load_package_scripts(repo_root)
    package_manager = detect_package_manager(repo_root)
    checks, notes = recommend_checks(classes, risk, files, scripts, package_manager)

    return {
        'repo_root': str(repo_root),
        'base': base,
        'head': head,
        'diff_mode': diff_mode,
        'package_manager': package_manager,
        'available_scripts': sorted(scripts.keys()),
        'changed_file_count': len(files),
        'changed_files': sorted(files),
        'classification': classes,
        'risk_level': risk,
        'recommended_checks': checks,
        'notes': notes,
    }


def print_human(report: dict[str, Any]) -> None:
    print('PR Analyzer')
    print('=' * 40)
    print(f"Diff mode: {report['diff_mode']}")
    print(f"Package manager: {report['package_manager']}")
    print(f"Changed files: {report['changed_file_count']}")
    print(f"Risk level: {report['risk_level']}")

    if report['available_scripts']:
        print('\nDetected scripts:')
        for script_name in report['available_scripts']:
            print(f'- {script_name}')

    print('\nClassification:')
    for key, value in report['classification'].items():
        print(f"- {key}: {'yes' if value else 'no'}")

    if report['changed_files']:
        print('\nChanged files:')
        for file_path in report['changed_files']:
            print(f'- {file_path}')

    print('\nRecommended checks:')
    for check in report['recommended_checks']:
        print(f'- {check}')

    if report['notes']:
        print('\nNotes:')
        for note in report['notes']:
            print(f'- {note}')


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Analyze git diff scope for code review.')
    parser.add_argument('--target', default='.', help='Repository path or file inside repo.')
    parser.add_argument('--base', default='origin/main', help='Base ref for diff comparison.')
    parser.add_argument('--head', default='HEAD', help='Head ref for diff comparison.')
    parser.add_argument('--staged', action='store_true', help='Analyze staged files only.')
    parser.add_argument(
        '--include-untracked',
        action='store_true',
        help='Include untracked files in changed file list.',
    )
    parser.add_argument('--json', action='store_true', help='Print report as JSON.')
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        repo_root = get_repo_root(args.target)
        files, diff_mode = diff_files(repo_root, args.base, args.head, args.staged)
        if args.include_untracked:
            files = sorted(set(files + untracked_files(repo_root)))

        report = build_report(repo_root, files, args.base, args.head, diff_mode)

        if args.json:
            print(json.dumps(report, indent=2))
        else:
            print_human(report)

        return 0
    except RuntimeError as error:
        print(f'error: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
