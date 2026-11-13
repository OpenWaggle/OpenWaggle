import { spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { Schema } from 'effect'
import { PR_SCRATCH_DIRECTORY, parseJson } from './cli'

const GATE_SCRIPTS = ['check', 'test', 'build'] as const
const FAILURE_TAIL_LINES = 60
const MS_PER_SECOND = 1000
/** Test workers for the gate's test step unless the caller sets VITEST_MAX_WORKERS. */
const GATE_TEST_WORKERS = '4'
const BUN_RUN_STEP = /^bun run (?<name>[\w:-]+)$/
const VITEST_CONFIG = /\bvitest run -c (?<config>vitest\.[\w-]+\.config\.ts)\b/
const FAILED_TEST_FILE = /(?<file>[\w./@-]+\.test\.tsx?)(?::\d+:\d+ FAIL | \(file failed\))/

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

/** The test files a failed Vitest log names, each once, in the order they first failed. */
export function failedTestFiles(log: string) {
  const files = new Set<string>()
  for (const line of log.split('\n')) {
    const file = FAILED_TEST_FILE.exec(line)?.groups?.file
    if (file !== undefined) files.add(file)
  }
  return [...files]
}

function runLogged(logName: string, args: readonly string[], env: NodeJS.ProcessEnv) {
  const logPath = path.join(PR_SCRATCH_DIRECTORY, `gate-${logName}.log`)
  const log = openSync(logPath, 'w')
  const startedAt = Date.now()
  const result = spawnSync('bun', args, { stdio: ['ignore', log, log], env })
  closeSync(log)
  const seconds = Math.round((Date.now() - startedAt) / MS_PER_SECOND)
  return {
    logPath,
    seconds,
    passed: result.error === undefined && result.status === 0,
    error: result.error,
  }
}

function reportFailure(label: string, run: ReturnType<typeof runLogged>) {
  console.error(`gate: ${label} failed after ${String(run.seconds)}s (log: ${run.logPath})`)
  console.error(run.error?.message ?? tail(run.logPath))
}

/**
 * A busy machine times out tests that pass on their own, so each test file a failed tier names
 * runs once more, alone. A tier whose log names no file, or a file that fails again, still fails.
 */
function rerunFailedTestFiles(logPath: string, config: string, env: NodeJS.ProcessEnv) {
  const files = failedTestFiles(readFileSync(logPath, 'utf8'))
  if (files.length === 0) return false
  const rerunEnv = { ...env, VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true' }
  const stillFailing = files.filter((file, index) => {
    const rerun = runLogged(
      `test-rerun-${String(index)}`,
      ['--bun', 'vitest', 'run', '-c', config, file],
      rerunEnv,
    )
    return !rerun.passed
  })
  if (stillFailing.length > 0) {
    console.error(`gate: still failing when rerun alone: ${stillFailing.join(', ')}`)
    return false
  }
  console.log(`gate: passed when rerun alone (load timeouts): ${files.join(', ')}`)
  return true
}

/** Runs every step of the `test` script, so each tier runs even when an earlier one failed. */
function runTestSteps() {
  const { scripts } = Schema.decodeUnknownSync(PackageScriptsSchema)(
    parseJson(readFileSync('package.json', 'utf8')),
  )
  const env = {
    ...process.env,
    VITEST_MAX_WORKERS: process.env.VITEST_MAX_WORKERS ?? GATE_TEST_WORKERS,
  }
  let passed = true
  for (const step of testSteps(scripts)) {
    const run = runLogged(`test-${step.name.replaceAll(':', '-')}`, ['run', step.name], env)
    const stepPassed =
      run.passed ||
      (step.config !== undefined && rerunFailedTestFiles(run.logPath, step.config, env))
    if (!stepPassed) reportFailure(`bun run ${step.name}`, run)
    passed &&= stepPassed
  }
  return passed
}

/**
 * Runs `bun run check`, every step of `test` and `build` one after another, each into its own
 * log under `.tmp/pr/`. A green step prints one line; a red one prints the end of its log. The
 * test steps run with at most four workers unless VITEST_MAX_WORKERS says otherwise, and a test
 * file that fails gets one rerun on its own before the gate fails.
 */
export function runReadyGate() {
  mkdirSync(PR_SCRATCH_DIRECTORY, { recursive: true })
  for (const script of GATE_SCRIPTS) {
    if (script === 'test') {
      if (!runTestSteps()) return false
      console.log('gate: bun run test ok')
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
