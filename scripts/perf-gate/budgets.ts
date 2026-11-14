/**
 * The performance budgets file's commands.
 *
 *   bun scripts/perf-gate/budgets.ts check
 *     The `perf-budgets` step of `bun run check`: measures `out/` and `node_modules` and fails when
 *     performance/perf-budgets.json differs from the measurement or from budget-metrics.ts.
 *   bun run perf:budgets:update [--no-build]
 *     Builds, measures every metric (the build, then the integration tests that measure the rest)
 *     and rewrites the file.

 * The Performance Gate compares the file with main's in scripts/perf-gate/gate.ts (`budgets`).
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  formatPerfBudgetFile,
  PERF_BUDGET_FRAGMENTS_ENV,
  PERF_BUDGETS_FILE,
  perfBudgetFileFor,
  perfBudgetShapeProblems,
  readPerfBudgetFile,
  recordPerfMeasurements,
} from './budget-file'
import { BUILD_SOURCE, PERF_BUDGET_METRICS } from './budget-metrics'
import { measureBuild } from './build-metrics'
import { measurePackageClosure } from './package-closure'

const FIRST_ARGUMENT = 2
const BUILD_GROUP = 'build'

function measureBuildSource() {
  const closure = measurePackageClosure()
  return {
    'package.runtime.packages': closure.packages,
    'package.runtime.files': closure.files,
    'package.runtime.bytes': closure.bytes,
    ...measureBuild(),
  }
}

function check() {
  const problems = [
    ...perfBudgetShapeProblems(readPerfBudgetFile()),
    ...recordPerfMeasurements(BUILD_GROUP, measureBuildSource()).map(
      (mismatch) => mismatch.message,
    ),
  ]
  for (const problem of problems) console.error(problem)
  return problems.length === 0 ? 0 : 1
}

function run(command: string, args: readonly string[], environment: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: environment })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited ${String(result.status)}`)
  }
}

function testSources() {
  return [
    ...new Set(
      PERF_BUDGET_METRICS.map((metric) => metric.source).filter(
        (source) => source !== BUILD_SOURCE,
      ),
    ),
  ]
}

function update(build: boolean) {
  const fragments = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-budgets-'))
  try {
    if (build) run('bunx', ['electron-vite', 'build', '--logLevel', 'warn'], process.env)
    const environment = { ...process.env, [PERF_BUDGET_FRAGMENTS_ENV]: fragments }
    recordPerfMeasurements(BUILD_GROUP, measureBuildSource(), environment)
    const tests = testSources()
    if (tests.length > 0) {
      run('bun', ['scripts/rebuild-native-deps.ts', 'node'], process.env)
      run(
        'bun',
        [
          '--bun',
          'vitest',
          'run',
          '-c',
          'vitest.integration.config.ts',
          '--maxWorkers=4',
          ...tests,
        ],
        { ...environment, VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true' },
      )
    }
    const measured: Record<string, number> = {}
    for (const name of fs.readdirSync(fragments)) {
      const parsed: unknown = JSON.parse(fs.readFileSync(path.join(fragments, name), 'utf8'))
      if (typeof parsed !== 'object' || parsed === null) continue
      for (const [id, value] of Object.entries(parsed)) {
        if (typeof value === 'number') measured[id] = value
      }
    }
    fs.writeFileSync(PERF_BUDGETS_FILE, formatPerfBudgetFile(perfBudgetFileFor(measured)))
    console.log(`Wrote ${PERF_BUDGETS_FILE}.`)
  } finally {
    fs.rmSync(fragments, { recursive: true, force: true })
  }
  return 0
}

export function main(argv: readonly string[]) {
  const [command, ...rest] = argv
  if (command === 'check') return check()
  if (command === 'update') return update(!rest.includes('--no-build'))
  throw new Error('Usage: see the header of scripts/perf-gate/budgets.ts.')
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(FIRST_ARGUMENT))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
