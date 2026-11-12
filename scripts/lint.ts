/**
 * Checks formatting with oxfmt (.oxfmtrc.json), runs the repository linter over
 * oxlint.config.mts, and prints a compact report: one line when clean, otherwise one
 * `file:line:col rule message` line per finding.
 *
 * `bun lint` is pinned to a dated Bun canary (ADR 0064): it exists only in canary builds, so it
 * runs from that canary's platform binary while the runtime stays on stable Bun. The private
 * workspace package tools/bun-lint names the canary's `@oven/bun-<platform>` packages as optional
 * dependencies, so bun.lock locks them and minimumReleaseAge and check:provenance apply.
 * `--runner=oxlint` runs the same config through oxlint, the fallback runner.
 *
 *   bun scripts/lint.ts [--runner=bun|oxlint] [--fix] [--format-only|--lint-only] [paths...]
 *
 * `--fix` formats the files and applies lint fixes instead of reporting them. `--format-only` and
 * `--lint-only` run one half, so the check runner (scripts/check/run.ts) runs them in parallel.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { compactLintOutput } from './oxlint/compact-output'

/** Holds the canary pin; bump the versions in its package.json like any other dependency. */
const BUN_LINT_PACKAGE_JSON = path.join(
  import.meta.dirname,
  '..',
  'tools',
  'bun-lint',
  'package.json',
)
const LINT_PATHS = [
  'src',
  'packages',
  'scripts',
  'website',
  'functions',
  'fixtures',
  '.pi',
  'electron.vite.config.ts',
  'electron-builder.ts',
]
const MILLISECONDS_PER_SECOND = 1000
const SCRIPT_ARGUMENTS_START = 2

type Runner = 'bun' | 'oxlint'
type Part = 'both' | 'format' | 'lint'

function parseArguments(argv: readonly string[]) {
  let runner: Runner = 'bun'
  let fix = false
  let part: Part = 'both'
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
    if (argument === '--format-only' || argument === '--lint-only') {
      part = argument === '--format-only' ? 'format' : 'lint'
      continue
    }
    paths.push(argument)
  }
  return { runner, fix, part, paths }
}

function lintCommand(runner: Runner, fix: boolean, paths: readonly string[]) {
  const shared = ['--deny-warnings', '-f', 'unix', ...(fix ? ['--fix'] : []), ...paths]
  if (runner === 'oxlint') {
    // oxlint loads the TypeScript config and plugins through Node, which warns once that the
    // root package.json declares no module type.
    const nodeOptions = [
      process.env['NODE_OPTIONS'],
      '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
    ]
    return {
      command: 'node',
      args: [packageBin('oxlint', 'oxlint'), ...shared],
      env: { ...process.env, NODE_OPTIONS: nodeOptions.filter(Boolean).join(' ') },
    }
  }
  // --no-inline-config: no comment can switch a rule off; openwaggle/no-lint-directive-comments
  // reports every directive in both runners.
  return {
    command: bunLintExecutable(),
    args: ['lint', '--no-script', '--no-inline-config', ...shared],
    env: process.env,
  }
}

/** `@oven/bun-<os>-<arch>[-musl]`, the names Bun's npm packages use. */
export function bunLintPlatformPackages(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
) {
  const os = platform === 'win32' ? 'windows' : platform
  const cpu = arch === 'arm64' ? 'aarch64' : arch
  const name = `@oven/bun-${os}-${cpu}`
  return platform === 'linux' ? [name, `${name}-musl`] : [name]
}

/** The canary binary bun install placed for this platform (glibc first on Linux). */
function bunLintExecutable() {
  const require = createRequire(BUN_LINT_PACKAGE_JSON)
  const binary = process.platform === 'win32' ? 'bun.exe' : 'bun'
  for (const packageName of bunLintPlatformPackages()) {
    try {
      return path.join(path.dirname(require.resolve(`${packageName}/package.json`)), 'bin', binary)
    } catch {
      // Not installed for this platform or libc; try the next candidate.
    }
  }
  throw new Error(
    `No ${bunLintPlatformPackages().join(' or ')} in tools/bun-lint; run bun install, or use --runner=oxlint.`,
  )
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

function seconds(started: number) {
  return ((performance.now() - started) / MILLISECONDS_PER_SECOND).toFixed(1)
}

function main() {
  const { runner, fix, part, paths } = parseArguments(process.argv.slice(SCRIPT_ARGUMENTS_START))
  const started = performance.now()
  // Without paths, oxfmt formats the whole repository (.oxfmtrc.json decides the files) and
  // lint covers LINT_PATHS.
  const formatting = part === 'lint' ? [] : formatFindings(fix, paths)
  if (part === 'format') {
    if (formatting.length === 0) {
      console.log(`format: no problems (oxfmt, ${seconds(started)}s)`)
      return
    }
    for (const line of formatting) console.log(line)
    process.exitCode = 1
    return
  }
  let invocation: ReturnType<typeof lintCommand>
  try {
    invocation = lintCommand(runner, fix, paths.length > 0 ? paths : LINT_PATHS)
  } catch (error) {
    console.error(`lint: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
    return
  }
  const { command, args, env } = invocation
  const result = spawnSync(command, args, { encoding: 'utf8', env, shell: false })
  if (result.error) {
    console.error(`lint: could not start ${command}: ${result.error.message}`)
    process.exitCode = 1
    return
  }

  const lines = [...formatting, ...compactLintOutput(`${result.stdout}\n${result.stderr}`)]
  const tools = part === 'lint' ? `${runner} lint` : `oxfmt + ${runner} lint`
  if (result.status === 0 && formatting.length === 0) {
    console.log(`lint: no problems (${tools}, ${seconds(started)}s)`)
    return
  }

  for (const line of lines) console.log(line)
  process.exitCode = result.status || 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
