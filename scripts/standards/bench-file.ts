import { execFileSync } from 'node:child_process'
import { scriptEnv } from '../support/env'
import type { Violation } from './violation'

/**
 * `performance/perf-gate/bench.json` points the Performance Gate at any base, head and pair count
 * (.github/workflows/perf-gate.yml). It belongs on a throwaway `bench/*` branch only: on main or a
 * pull request branch it would sit in the tree as if it configured the gate.
 */
export const BENCH_FILE = 'performance/perf-gate/bench.json'
const BENCH_BRANCH_PREFIX = 'bench/'
const BRANCH_REF_PREFIX = 'refs/heads/'

/**
 * The branch being checked: a pull request's head branch in CI, the pushed branch on a push,
 * else the local checkout's (undefined when detached).
 */
export function currentBranch(env = scriptEnv(), localBranch = readLocalBranch) {
  if (env.GITHUB_HEAD_REF !== undefined && env.GITHUB_HEAD_REF !== '') return env.GITHUB_HEAD_REF
  if (env.GITHUB_REF?.startsWith(BRANCH_REF_PREFIX) === true) {
    return env.GITHUB_REF.slice(BRANCH_REF_PREFIX.length)
  }
  const local = localBranch()
  return local === '' ? undefined : local
}

function readLocalBranch() {
  try {
    return execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

export function collectBenchFileViolations(
  present: ReadonlySet<string>,
  branch: string | undefined,
) {
  if (!present.has(BENCH_FILE) || branch?.startsWith(BENCH_BRANCH_PREFIX) === true) return []
  const violation: Violation = {
    file: BENCH_FILE,
    message: `${BENCH_FILE} configures a Performance Gate bench and belongs only on a ${BENCH_BRANCH_PREFIX}* branch; remove it`,
    detail: `branch ${branch ?? '(detached HEAD)'}`,
  }
  return [violation]
}
