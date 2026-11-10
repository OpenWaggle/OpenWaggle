import { spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { PR_SCRATCH_DIRECTORY } from './cli'

const GATE_SCRIPTS = ['check', 'test', 'build'] as const
const FAILURE_TAIL_LINES = 60
const MS_PER_SECOND = 1000

function tail(filePath: string) {
  const lines = readFileSync(filePath, 'utf8').trimEnd().split('\n')
  return lines.slice(-FAILURE_TAIL_LINES).join('\n')
}

/**
 * Runs `bun run check`, `test` and `build` one after another, each into its own log under
 * `.tmp/pr/`. A green step prints one line; a red one prints the end of its log and stops.
 */
export function runReadyGate() {
  mkdirSync(PR_SCRATCH_DIRECTORY, { recursive: true })
  for (const script of GATE_SCRIPTS) {
    const logPath = path.join(PR_SCRATCH_DIRECTORY, `gate-${script}.log`)
    const log = openSync(logPath, 'w')
    const startedAt = Date.now()
    const result = spawnSync('bun', ['run', script], { stdio: ['ignore', log, log] })
    closeSync(log)
    const seconds = Math.round((Date.now() - startedAt) / MS_PER_SECOND)
    if (result.error !== undefined || result.status !== 0) {
      console.error(`gate: bun run ${script} failed after ${String(seconds)}s (log: ${logPath})`)
      console.error(result.error?.message ?? tail(logPath))
      return false
    }
    console.log(`gate: bun run ${script} ok (${String(seconds)}s)`)
  }
  return true
}
