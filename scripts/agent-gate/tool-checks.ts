/**
 * The gate's tool runs over changed files: oxfmt for formatting (TOOL-05), and one type-aware lint
 * run with `--type-check` that reports lint findings and TypeScript errors together. The type
 * check also covers the files that import a changed module, keeping only their type errors, so a
 * changed signature that breaks a caller is caught without type-checking whole projects.
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { compactLintOutput } from '../oxlint/compact-output'
import { type Finding, type ToolFailure, parseFindingLine } from './findings'
import type { RunProcess } from './run-process'

export type LintRunner = 'oxlint' | 'bun'

export interface ToolCheckInput {
  readonly root: string
  readonly files: readonly string[]
  readonly importers: readonly string[]
  readonly run: RunProcess
  readonly runner: LintRunner
  readonly signal?: AbortSignal
}

export interface ToolCheckResult {
  readonly findings: readonly Finding[]
  readonly failures: readonly ToolFailure[]
}

const FORMATTED = /\.(?:[cm]?[jt]sx?)$/u
/** The paths `bun run lint` covers (scripts/lint.ts LINT_PATHS). */
const LINTED =
  /^(?:src|packages|scripts|website|functions|fixtures)\/.*\.(?:[cm]?[jt]sx?|astro)$|^electron\.vite\.config\.ts$/u
const TYPE_ERROR_RULE = /^typescript\/(?<code>TS\d+)$/u
const FORMAT_TIMEOUT_MS = 30_000
const LINT_TIMEOUT_MS = 90_000
const FINDINGS_EXIT_CODE = 1
const MAX_REASON_LENGTH = 160
const BUN_LINT_CANARY = 'tools/bun-lint/package.json'

function packageBin(root: string, name: string) {
  const manifest = createRequire(path.join(root, 'package.json')).resolve(`${name}/package.json`)
  return path.join(path.dirname(manifest), 'bin', name)
}

function bunLintBinary(root: string) {
  const os = process.platform === 'win32' ? 'windows' : process.platform
  const cpu = process.arch === 'arm64' ? 'aarch64' : process.arch
  const manifest = createRequire(path.join(root, BUN_LINT_CANARY)).resolve(
    `@oven/bun-${os}-${cpu}/package.json`,
  )
  return path.join(path.dirname(manifest), 'bin', process.platform === 'win32' ? 'bun.exe' : 'bun')
}

function failure(check: string, files: readonly string[], reason: string): ToolCheckResult {
  return { findings: [], failures: [{ check, files, reason }] }
}

function reasonOf(result: { readonly timedOut: boolean; readonly stderr: string }) {
  if (result.timedOut) return 'timed out'
  const firstLine = result.stderr.trim().split('\n')[0] ?? ''
  return firstLine === '' ? 'exited unexpectedly' : firstLine.slice(0, MAX_REASON_LENGTH)
}

export async function formatCheck(input: ToolCheckInput): Promise<ToolCheckResult> {
  const files = input.files.filter((file) => FORMATTED.test(file))
  if (files.length === 0) return { findings: [], failures: [] }
  let oxfmt: string
  try {
    oxfmt = packageBin(input.root, 'oxfmt')
  } catch {
    return failure('format', files, 'oxfmt is not installed; run bun install')
  }
  const result = await input.run('node', [oxfmt, '--list-different', ...files], {
    cwd: input.root,
    timeoutMs: FORMAT_TIMEOUT_MS,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  })
  if (result.code === 0) return { findings: [], failures: [] }
  const listed = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  if (result.code !== FINDINGS_EXIT_CODE || listed.length === 0) {
    return failure('format', files, reasonOf(result))
  }
  return {
    findings: listed.map((file) => ({
      file,
      rule: 'oxfmt',
      id: 'TOOL-05',
      message: 'not formatted; run bun run format',
      severity: 'block' as const,
    })),
    failures: [],
  }
}

function lintInvocation(input: ToolCheckInput, files: readonly string[]) {
  const shared = ['--type-aware', '--type-check', '--deny-warnings', '-f', 'unix', ...files]
  if (input.runner === 'bun') {
    return {
      command: bunLintBinary(input.root),
      args: ['lint', '--no-script', '--no-inline-config', ...shared],
    }
  }
  return {
    command: 'node',
    args: [
      '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
      packageBin(input.root, 'oxlint'),
      ...shared,
    ],
  }
}

/** Lint findings in changed files, and type errors in changed files and their importers. */
export async function lintAndTypeCheck(input: ToolCheckInput): Promise<ToolCheckResult> {
  const changed = input.files.filter((file) => LINTED.test(file))
  const importers = input.importers.filter((file) => LINTED.test(file) && !changed.includes(file))
  if (changed.length === 0) return { findings: [], failures: [] }
  let invocation: ReturnType<typeof lintInvocation>
  try {
    invocation = lintInvocation(input, [...changed, ...importers])
  } catch {
    return failure(
      'lint',
      changed,
      `the ${input.runner} lint runner is not installed; run bun install`,
    )
  }
  const result = await input.run(invocation.command, invocation.args, {
    cwd: input.root,
    timeoutMs: LINT_TIMEOUT_MS,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  })
  const lines = compactLintOutput(`${result.stdout}\n${result.stderr}`)
  const parsed = lines.map((line) => parseFindingLine(line, 'block'))
  if (
    result.code !== 0 &&
    (result.code !== FINDINGS_EXIT_CODE || parsed.every((finding) => finding === undefined))
  ) {
    return failure('lint', changed, reasonOf(result))
  }
  const own = new Set(changed)
  const findings = parsed.flatMap((finding) => {
    if (finding === undefined) return []
    const code = TYPE_ERROR_RULE.exec(finding.rule)?.groups?.['code']
    if (code === undefined) return own.has(finding.file) ? [finding] : []
    return [{ ...finding, rule: code }]
  })
  return { findings, failures: [] }
}
