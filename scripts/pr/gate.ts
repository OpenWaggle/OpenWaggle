import { spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { Schema } from 'effect'
import { PR_SCRATCH_DIRECTORY, parseJson } from './cli'

const GATE_SCRIPTS = ['check', 'test', 'build'] as const
const FAILURE_TAIL_LINES = 60
const MS_PER_SECOND = 1000
/** Test workers for the gate's test steps unless the caller sets VITEST_MAX_WORKERS. */
const GATE_TEST_WORKERS = '4'
const GATE_LOG = /^gate-.*\.log$/
const BUN_RUN_STEP = /^bun run (?<name>[\w:-]+)$/
/** A step gets a rerun only when its whole command is one Vitest run, so nothing after it can be skipped. */
const VITEST_CONFIG = /^(?:\w+=\S+ )*bun --bun vitest run -c (?<config>vitest\.[\w-]+\.config\.ts)$/
const FAIL_LINE = /^(?<location>\S*) FAIL (?<name>.*)$/
const LINE_AND_COLUMN = /:\d+:\d+$/
const TEST_FILE = /^[\w./@-]+\.test\.tsx?$/
const FILE_FAILED = /^(?<file>[\w./@-]+\.test\.tsx?) \(file failed\)$/
const UNHANDLED_ERRORS = /\bunhandled errors?\b/i

const PackageScriptsSchema = Schema.Struct({
  scripts: Schema.Record({ key: Schema.String, value: Schema.String }),
})

function tail(filePath: string) {
  const lines = readFileSync(filePath, 'utf8').trimEnd().split('\n')
  return lines.slice(-FAILURE_TAIL_LINES).join('\n')
}

/**
 * The `bun run <name>` steps the `test` script chains with `&&`, each with the Vitest config it
 * runs, if any. The gate runs them one by one, so a failed tier never stops the later ones.
 */
export function testSteps(scripts: Readonly<Record<string, string>>) {
  const testScript = scripts.test
  if (testScript === undefined) throw new Error('package.json has no test script')
  return testScript.split(' && ').map((part) => {
    const name = BUN_RUN_STEP.exec(part.trim())?.groups?.name
    const command = name === undefined ? undefined : scripts[name]
    if (name === undefined || command === undefined) {
      throw new Error(`The test script step "${part}" is not \`bun run <script>\``)
    }
    return { name, config: VITEST_CONFIG.exec(command)?.groups?.config }
  })
}

function failedTestFile(location: string, name: string) {
  const file = location.replace(LINE_AND_COLUMN, '')
  return TEST_FILE.test(file) ? file : FILE_FAILED.exec(name)?.groups?.file
}

/**
 * The test files to rerun alone for a failed Vitest tier, each once, in the order they first
 * failed. Undefined when a rerun could hide a failure: an unhandled error, no `FAIL` line at all,
 * or a `FAIL` line that names no test file (an async helper's frame, an unhandled rejection).
 */
export function rerunCandidates(log: string) {
  if (UNHANDLED_ERRORS.test(log)) return undefined
  const files = new Set<string>()
  for (const line of log.split('\n')) {
    const groups = FAIL_LINE.exec(line)?.groups
    if (groups === undefined) continue
    const file = failedTestFile(groups.location ?? '', groups.name ?? '')
    if (file === undefined) return undefined
    files.add(file)
  }
  return files.size === 0 ? undefined : [...files]
}

function runLogged(logName: string, args: readonly string[], env: NodeJS.ProcessEnv) {
  const logPath = path.join(PR_SCRATCH_DIRECTORY, `gate-${logName}.log`)
  const log = openSync(logPath, 'w')
  const startedAt = Date.now()
  const result = spawnSync('bun', args, { stdio: ['ignore', log, log], env })
  closeSync(log)
  const seconds = Math.round((Date.now() - startedAt) / MS_PER_SECOND)
  const passed = result.error === undefined && result.status === 0
  return { logPath, seconds, passed, error: result.error }
}

function reportFailure(label: string, run: ReturnType<typeof runLogged>) {
  console.error(`gate: ${label} failed after ${String(run.seconds)}s (log: ${run.logPath})`)
  console.error(run.error?.message ?? tail(run.logPath))
}

/**
 * A busy machine times out tests that pass on their own, so each test file a failed tier names
 * runs once more, alone. Anything `rerunCandidates` cannot attribute, or a file that fails again,
 * still fails. Files that pass only alone are printed, so a real cross-file leak stays visible.
 */
function rerunFailedTestFiles(
  stepLogName: string,
  logPath: string,
  config: string,
  env: NodeJS.ProcessEnv,
) {
  const files = rerunCandidates(readFileSync(logPath, 'utf8'))
  if (files === undefined) {
    console.error(
      'gate: nothing rerun: a failure names no test file, or there is an unhandled error',
    )
    return false
  }
  const rerunEnv = { ...env, VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true' }
  const reruns = files.map((file, index) => ({
    file,
    run: runLogged(
      `${stepLogName}-rerun-${String(index)}`,
      ['--bun', 'vitest', 'run', '-c', config, file],
      rerunEnv,
    ),
  }))
  const stillFailing = reruns.filter(({ run }) => !run.passed)
  for (const { file, run } of stillFailing) {
    console.error(`gate: ${file} failed again when rerun alone (log: ${run.logPath})`)
  }
  if (stillFailing.length > 0) return false
  console.warn(`gate: WARNING failed in the full run, passed alone: ${files.join(', ')}`)
  return true
}

/** Runs every step of the `test` script, so each tier runs even when an earlier one failed. */
function runTestSteps() {
  const { scripts } = Schema.decodeUnknownSync(PackageScriptsSchema)(
    parseJson(readFileSync('package.json', 'utf8')),
  )
  const maxWorkers = process.env.VITEST_MAX_WORKERS || GATE_TEST_WORKERS
  const env = { ...process.env, VITEST_MAX_WORKERS: maxWorkers }
  const results = testSteps(scripts).map((step) => runTestStep(step, env))
  return results.every(Boolean)
}

function runTestStep(step: ReturnType<typeof testSteps>[number], env: NodeJS.ProcessEnv) {
  const logName = `test-${step.name.replaceAll(':', '-')}`
  const run = runLogged(logName, ['run', step.name], env)
  const label = `bun run ${step.name}`
  if (run.passed) {
    console.log(`gate: ${label} ok (${String(run.seconds)}s)`)
    return true
  }
  if (step.config !== undefined && rerunFailedTestFiles(logName, run.logPath, step.config, env)) {
    console.log(`gate: ${label} ok after rerunning its failed files alone`)
    return true
  }
  reportFailure(label, run)
  return false
}

function removeOldGateLogs() {
  mkdirSync(PR_SCRATCH_DIRECTORY, { recursive: true })
  for (const name of readdirSync(PR_SCRATCH_DIRECTORY)) {
    if (GATE_LOG.test(name)) rmSync(path.join(PR_SCRATCH_DIRECTORY, name))
  }
}

/**
 * Runs `bun run check`, every step of `test` and `build` one after another, each into its own
 * log under `.tmp/pr/`. A green step prints one line; a red one prints the end of its log. The
 * test steps run with at most four workers unless VITEST_MAX_WORKERS says otherwise, and a test
 * file that fails gets one rerun on its own before the gate fails.
 */
export function runReadyGate() {
  removeOldGateLogs()
  for (const script of GATE_SCRIPTS) {
    if (script === 'test') {
      if (!runTestSteps()) return false
      continue
    }
    const run = runLogged(script, ['run', script], process.env)
    if (!run.passed) {
      reportFailure(`bun run ${script}`, run)
      return false
    }
    console.log(`gate: bun run ${script} ok (${String(run.seconds)}s)`)
  }
  return true
}
