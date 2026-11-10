/**
 * Checks formatting with oxfmt (.oxfmtrc.json), runs the repository linter over
 * oxlint.config.mts, and prints a compact report: one line when clean, otherwise one
 * `file:line:col rule message` line per finding.
 *
 * `bun lint` is pinned to a dated Bun canary (ADR 0064): it exists only in canary builds, so it
 * runs from the npm `bun` package at BUN_LINT_VERSION while the runtime stays on stable Bun.
 * `--runner=oxlint` runs the same config through oxlint, the fallback runner.
 *
 *   bun scripts/lint.ts [--runner=bun|oxlint] [--fix] [paths...]
 *
 * `--fix` formats the files and applies lint fixes instead of reporting them.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { compactLintOutput } from './oxlint/compact-output'

/** A dated canary at least seven days old when pinned; bump it like any other dependency. */
const BUN_LINT_VERSION = '1.4.4-canary.20261103.1'
const LINT_PATHS = [
  'src',
  'packages',
  'scripts',
  'website',
  'functions',
  'fixtures',
  'electron.vite.config.ts',
]
const MILLISECONDS_PER_SECOND = 1000
const SCRIPT_ARGUMENTS_START = 2

type Runner = 'bun' | 'oxlint'

function parseArguments(argv: readonly string[]) {
  let runner: Runner = 'bun'
  let fix = false
  const paths: string[] = []
  for (const argument of argv) {
    if (argument === '--runner=oxlint' || argument === '--runner=bun') {
      runner = argument === '--runner=oxlint' ? 'oxlint' : 'bun'
      continue
    }
    if (argument === '--fix') {
      fix = true
      continue
    }
    paths.push(argument)
  }
  return { runner, fix, paths }
}

function lintCommand(runner: Runner, fix: boolean, paths: readonly string[]) {
  const shared = ['--deny-warnings', '-f', 'unix', ...(fix ? ['--fix'] : []), ...paths]
  if (runner === 'oxlint') {
    // oxlint loads the TypeScript config and plugins through Node, which warns once that the
    // root package.json declares no module type.
    const nodeOptions = [process.env.NODE_OPTIONS, '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON']
    return {
      command: 'node',
      args: [packageBin('oxlint', 'oxlint'), ...shared],
      env: { ...process.env, NODE_OPTIONS: nodeOptions.filter(Boolean).join(' ') },
    }
  }
  // --no-inline-config: no comment can switch a rule off; openwaggle/no-lint-directive-comments
  // reports every directive in both runners.
  const bun = process.versions.bun === undefined ? 'bun' : process.execPath
  return {
    command: bun,
    args: ['x', `bun@${BUN_LINT_VERSION}`, 'lint', '--no-script', '--no-inline-config', ...shared],
    env: process.env,
  }
}

function packageBin(packageName: string, bin: string) {
  const packageJson = createRequire(import.meta.url).resolve(`${packageName}/package.json`)
  return path.join(path.dirname(packageJson), 'bin', bin)
}

/** oxfmt writes with `--fix`, else lists the files it would change, as findings. */
function formatFindings(fix: boolean, paths: readonly string[]) {
  const mode = fix ? [] : ['--list-different']
  const result = spawnSync('node', [packageBin('oxfmt', 'oxfmt'), ...mode, ...paths], {
    encoding: 'utf8',
  })
  if (result.status === 0) {
    return []
  }
  const files = result.stdout.split(/\r?\n/u).filter((line) => line.trim() !== '')
  const findings = files.map((file) => `${file}:1:1 oxfmt not formatted; run bun run format`)
  return findings.length > 0 ? findings : [`oxfmt: ${result.stderr.trim() || 'failed'}`]
}

function main() {
  const { runner, fix, paths } = parseArguments(process.argv.slice(SCRIPT_ARGUMENTS_START))
  // Without paths, oxfmt formats the whole repository (.oxfmtrc.json decides the files) and
  // lint covers LINT_PATHS.
  const { command, args, env } = lintCommand(runner, fix, paths.length > 0 ? paths : LINT_PATHS)
  const started = performance.now()
  const formatting = formatFindings(fix, paths)
  const result = spawnSync(command, args, { encoding: 'utf8', env, shell: false })
  if (result.error) {
    console.error(`lint: could not start ${command}: ${result.error.message}`)
    process.exitCode = 1
    return
  }

  const lines = [...formatting, ...compactLintOutput(`${result.stdout}\n${result.stderr}`)]
  const seconds = ((performance.now() - started) / MILLISECONDS_PER_SECOND).toFixed(1)
  if (result.status === 0 && formatting.length === 0) {
    console.log(`lint: no problems (oxfmt + ${runner} lint, ${seconds}s)`)
    return
  }

  for (const line of lines) console.log(line)
  process.exitCode = result.status || 1
}

main()
