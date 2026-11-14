import type { CheckRun, StatusContext } from './watch-model'

/** One run plus two reruns per job per head SHA. */
export const MAX_CHECK_ATTEMPTS = 3

const RUNNING_STATUSES = new Set(['IN_PROGRESS', 'PENDING', 'QUEUED', 'REQUESTED'])
const FAILED_CONCLUSIONS = new Set(['CANCELLED', 'FAILURE', 'STARTUP_FAILURE', 'TIMED_OUT'])
const RUNNING_STATES = new Set(['EXPECTED', 'PENDING'])
const FAILED_STATES = new Set(['ERROR', 'FAILURE'])

export interface CheckSummary {
  readonly attempts: number
  readonly conclusion: string | undefined
  /** Job id for `--rerun-job`; undefined for commit statuses, which cannot be rerun from here. */
  readonly id: number | undefined
  readonly isRequired: boolean
  readonly logCommand: string | undefined
  readonly name: string
  readonly retriesLeft: number
  readonly status: string
  readonly url: string | undefined
}

export interface ChecksSummary {
  /**
   * Failures that block convergence. When branch protection marks some checks required, an
   * optional check's failure goes to `optionalFailed`; with no required checks, every failure blocks.
   */
  readonly failed: readonly CheckSummary[]
  readonly optionalFailed: readonly CheckSummary[]
  /** Waiting on a person: a deployment approval or a check that asks for action. */
  readonly needsApproval: readonly CheckSummary[]
  readonly running: readonly CheckSummary[]
  readonly total: number
}

function checkKey(run: CheckRun) {
  return `${run.workflowName ?? run.appSlug ?? 'checks'} / ${run.name}`
}

function summarizeRuns(runs: readonly CheckRun[]) {
  const latest = new Map<string, CheckRun>()
  const attempts = new Map<string, number>()
  for (const run of runs) {
    const key = checkKey(run)
    attempts.set(key, (attempts.get(key) ?? 0) + 1)
    const previous = latest.get(key)
    if (previous === undefined || run.id > previous.id) {
      latest.set(key, run)
    }
  }
  return [...latest.entries()].map(([key, run]) => {
    const count = attempts.get(key) ?? 1
    return {
      attempts: count,
      conclusion: run.conclusion,
      id: run.id,
      isRequired: run.isRequired,
      logCommand:
        run.runId === undefined
          ? undefined
          : `gh run view ${String(run.runId)} --job ${String(run.id)} --log-failed`,
      name: key,
      retriesLeft: Math.max(0, MAX_CHECK_ATTEMPTS - count),
      status: run.status,
      url: run.url,
    }
  })
}

function summarizeStatus(context: StatusContext) {
  return {
    attempts: 1,
    conclusion: context.state,
    id: undefined,
    isRequired: context.isRequired,
    logCommand: undefined,
    name: context.context,
    retriesLeft: 0,
    status: RUNNING_STATES.has(context.state) ? 'PENDING' : 'COMPLETED',
    url: context.url,
  } satisfies CheckSummary
}

function isFailed(check: CheckSummary) {
  return (
    check.status === 'COMPLETED' &&
    check.conclusion !== undefined &&
    (FAILED_CONCLUSIONS.has(check.conclusion) || FAILED_STATES.has(check.conclusion))
  )
}

export function summarizeChecks(runs: readonly CheckRun[], contexts: readonly StatusContext[]) {
  const checks = [...summarizeRuns(runs), ...contexts.map(summarizeStatus)]
  const anyRequired = checks.some((check) => check.isRequired)
  const failed = checks.filter(isFailed)
  const blocks = (check: CheckSummary) => !anyRequired || check.isRequired
  const summary: ChecksSummary = {
    failed: failed.filter(blocks),
    optionalFailed: failed.filter((check) => !blocks(check)),
    needsApproval: checks.filter(
      (check) => check.status === 'WAITING' || check.conclusion === 'ACTION_REQUIRED',
    ),
    running: checks.filter((check) => RUNNING_STATUSES.has(check.status)),
    total: checks.length,
  }
  return summary
}
