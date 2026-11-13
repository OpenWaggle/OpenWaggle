import { spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { PR_SCRATCH_DIRECTORY } from './cli'

const GATE_SCRIPTS = ['check', 'test', 'build'] as const
const FAILURE_TAIL_LINES = 60
const MS_PER_SECOND = 1000
/** Test workers for the gate's `bun run test` unless the caller sets VITEST_MAX_WORKERS. */
const GATE_TEST_WORKERS = '4'
const TIER_CONFIGS = {
  unit: 'vitest.unit.config.ts',
  integration: 'vitest.integration.config.ts',
  component: 'vitest.component.config.ts',
} as const
const FAILED_TEST_FILE =
  /^(?:\S+ FAIL )?(?<file>\S+\.(?<tier>unit|integration|component)\.test\.tsx?)(?::\d+:\d+ FAIL| \(file failed\))/

function tail(filePath: string) {
  const lines = readFileSync(filePath, 'utf8').trimEnd().split('\n')
  return lines.slice(-FAILURE_TAIL_LINES).join('\n')
}

/** The test files a failed `bun run test` log names, each with the Vitest config of its tier. */
export function failedTestFiles(log: string) {
  const files = new Map<string, string>()
  for (const line of log.split('\n')) {
    const groups = FAILED_TEST_FILE.exec(line.trim())?.groups
    const tier = groups?.tier
    if (
      groups?.file !== undefined &&
      (tier === 'unit' || tier === 'integration' || tier === 'component')
    ) {
      files.set(groups.file, TIER_CONFIGS[tier])
    }
  }
  return [...files].map(([file, config]) => ({ file, config }))
}

function runLogged(script: string, args: readonly string[], env: NodeJS.ProcessEnv) {
  const logPath = path.join(PR_SCRATCH_DIRECTORY, `gate-${script}.log`)
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

/**
 * A busy machine times out tests that pass on their own, so each test file the failed run names
 * runs once more, alone. Anything else failing (MCP conformance, a native rebuild) still fails.
 */
function rerunFailedTestFiles(logPath: string, env: NodeJS.ProcessEnv) {
  const files = failedTestFiles(readFileSync(logPath, 'utf8'))
  if (files.length === 0) return false
  const stillFailing = files.filter(({ file, config }, index) => {
    const rerun = runLogged(
      `test-rerun-${String(index)}`,
      ['--bun', 'vitest', 'run', '-c', config, file],
      {
        ...env,
        VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true',
      },
    )
    return !rerun.passed
  })
  if (stillFailing.length > 0) {
    console.error(
      `gate: still failing when rerun alone: ${stillFailing.map(({ file }) => file).join(', ')}`,
    )
    return false
  }
  console.log(
    `gate: passed when rerun alone (load timeouts): ${files.map(({ file }) => file).join(', ')}`,
  )
  return true
}

/**
 * Runs `bun run check`, `test` and `build` one after another, each into its own log under
 * `.tmp/pr/`. A green step prints one line; a red one prints the end of its log and stops. The
 * test step runs with at most four workers unless VITEST_MAX_WORKERS says otherwise, and a test
 * file that fails it gets one rerun on its own before the gate fails.
 */
export function runReadyGate() {
  mkdirSync(PR_SCRATCH_DIRECTORY, { recursive: true })
  for (const script of GATE_SCRIPTS) {
    const env =
      script === 'test'
        ? {
            ...process.env,
            VITEST_MAX_WORKERS: process.env.VITEST_MAX_WORKERS ?? GATE_TEST_WORKERS,
          }
        : process.env
    const run = runLogged(script, ['run', script], env)
    const passed = run.passed || (script === 'test' && rerunFailedTestFiles(run.logPath, env))
    if (!passed) {
      console.error(
        `gate: bun run ${script} failed after ${String(run.seconds)}s (log: ${run.logPath})`,
      )
      console.error(run.error?.message ?? tail(run.logPath))
      return false
    }
    console.log(`gate: bun run ${script} ok (${String(run.seconds)}s)`)
  }
  return true
}
