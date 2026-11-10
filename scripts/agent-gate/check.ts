/**
 * The agent gate by hand: the same checks and the same output as the end-of-turn gate, over the
 * files changed since a git ref.
 *
 *   bun scripts/agent-gate/check.ts [--base <ref>] [--runner oxlint|bun] [--no-plugins] [files...]
 *
 * Without files it checks every file changed since `--base` (default HEAD), untracked files
 * included. New suppressions, dependency pins and tsconfig changes are compared with the base.
 * Session-only checks (test runs, generator attribution, the user's approvals) have no history
 * here: an added dependency and a changed generated file are advisory lines instead.
 */
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { baselineAtRef } from './baseline'
import { dependencyCheck } from './dependencies'
import type { Finding } from './findings'
import { runGate } from './gate'
import { generatedFilesFor } from './generated-files'
import { qualityGatesPlugin } from './quality-gates-plugin'
import { checkReport } from './report'
import { runProcess } from '../agent-quality-gates/process'
import { git, repositoryRoot } from './git'
import type { LintRunner } from './tool-checks'

const GIT_TIMEOUT_MS = 15_000
const SCRIPT_ARGUMENTS_START = 2
const MILLISECONDS_PER_SECOND = 1000

export interface CheckArguments {
  readonly base: string
  readonly runner: LintRunner
  readonly plugins: boolean
  readonly files: readonly string[]
}

export function parseCheckArguments(argv: readonly string[]): CheckArguments {
  const valueOf = (flag: string) => {
    const index = argv.indexOf(flag)
    return index === -1 ? undefined : argv[index + 1]
  }
  const values = new Set(
    ['--base', '--runner'].flatMap((flag) => {
      const index = argv.indexOf(flag)
      return index === -1 ? [] : [index, index + 1]
    }),
  )
  return {
    base: valueOf('--base') ?? 'HEAD',
    runner: valueOf('--runner') === 'bun' ? 'bun' : 'oxlint',
    plugins: !argv.includes('--no-plugins'),
    files: argv.filter((argument, index) => !values.has(index) && argument !== '--no-plugins'),
  }
}

async function changedSince(root: string, base: string) {
  const [diff, untracked] = await Promise.all([
    git(runProcess, root, ['diff', '--name-only', '-z', '--no-renames', base], GIT_TIMEOUT_MS),
    git(runProcess, root, ['ls-files', '--others', '--exclude-standard', '-z'], GIT_TIMEOUT_MS),
  ])
  return [...new Set(`${diff ?? ''}\0${untracked ?? ''}`.split('\0').filter(Boolean))].sort()
}

function generatedAdvisories(files: readonly string[]): Finding[] {
  return files.flatMap((file) => {
    const entry = generatedFilesFor(file)
    return entry === undefined
      ? []
      : [
          {
            file,
            rule: 'gate/generated',
            id: 'TOOL-07',
            message: `${entry.name} changed; make sure its generator wrote it`,
            severity: 'advisory' as const,
          },
        ]
  })
}

export async function main(argv: readonly string[]) {
  const options = parseCheckArguments(argv)
  const root = await repositoryRoot(runProcess, process.cwd())
  if (root === undefined) {
    console.error('agent-gate: not inside a git repository')
    return 1
  }
  const started = performance.now()
  const files = options.files.length > 0 ? options.files : await changedSince(root, options.base)
  const verdict = await runGate({
    root,
    files,
    baseline: baselineAtRef(runProcess, root, options.base),
    run: runProcess,
    runner: options.runner,
    sessionFindings: generatedAdvisories(files),
    dependencies: dependencyCheck({ approved: () => false, unapproved: 'advisory' }),
    plugins: options.plugins ? [qualityGatesPlugin] : [],
  })
  const seconds = ((performance.now() - started) / MILLISECONDS_PER_SECOND).toFixed(1)
  for (const line of checkReport(verdict.findings, verdict.failures, files.length, seconds)) {
    console.log(line)
  }
  return verdict.findings.some((finding) => finding.severity === 'block') ? 1 : 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(SCRIPT_ARGUMENTS_START))
}
