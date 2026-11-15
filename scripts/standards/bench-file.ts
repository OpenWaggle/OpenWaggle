import { execFileSync } from 'node:child_process'
import { scriptEnv } from '../support/env'
import type { Violation } from './violation'

/**
 * `performance/perf-gate/bench.json` points the Performance Gate at any base, head and pair count
 * (.github/workflows/perf-gate.yml), and the Electron bench's nightly A/B at a base
 * (bench-electron.yml). It belongs on a throwaway branch those workflows run on a push only:
 * on main or a pull request it would sit in the tree as if it configured the gate, so a pull
 * request or merge group check fails it on any branch.
 */
export const BENCH_FILE = 'performance/perf-gate/bench.json'
const BENCH_BRANCH_PREFIXES = ['bench/perf-gate-', 'bench/electron-best-'] as const
const BRANCH_REF_PREFIX = 'refs/heads/'
/** Events whose run would carry the file towards main; benches run on a push. */
const MERGE_EVENTS: ReadonlySet<string> = new Set([
  'pull_request',
  'pull_request_target',
  'merge_group',
])

/** What decides whether the file may be there: the branch, and the CI event when there is one. */
export interface BenchContext {
  readonly branch: string | undefined
  readonly event: string | undefined
}

export function benchContext(env = scriptEnv(), localBranch = readLocalBranch) {
  const context: BenchContext = {
    branch: currentBranch(env, localBranch),
    event: env.GITHUB_EVENT_NAME,
  }
  return context
}

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

function isBenchBranch(branch: string | undefined) {
  return BENCH_BRANCH_PREFIXES.some((prefix) => branch?.startsWith(prefix) === true)
}

export function collectBenchFileViolations(present: ReadonlySet<string>, context: BenchContext) {
  if (!present.has(BENCH_FILE)) return []
  const mergeEvent =
    context.event !== undefined && MERGE_EVENTS.has(context.event) ? context.event : undefined
  const merging = mergeEvent !== undefined
  if (!merging && isBenchBranch(context.branch)) return []
  const where = BENCH_BRANCH_PREFIXES.map((prefix) => `${prefix}*`).join(' or ')
  const violation: Violation = {
    file: BENCH_FILE,
    message: merging
      ? `${BENCH_FILE} configures a bench, which runs on a push only; remove it before opening a pull request`
      : `${BENCH_FILE} configures a bench and belongs only on a ${where} branch; remove it`,
    detail: `branch ${context.branch ?? '(detached HEAD)'}${mergeEvent === undefined ? '' : `, event ${mergeEvent}`}`,
  }
  return [violation]
}
