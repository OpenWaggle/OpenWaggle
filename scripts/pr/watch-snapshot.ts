import { createHash } from 'node:crypto'
import { type BotReviews, botReviews } from './watch-bots'
import { type CheckSummary, MAX_CHECK_ATTEMPTS, summarizeChecks } from './watch-checks'
import { type AnsweredThread, collectComments, type OpenItem } from './watch-comments'
import type { PullRequestState } from './watch-model'

const SIGNATURE_LENGTH = 12

export type WatchAction =
  | {
      readonly reason: 'checks_need_approval' | 'closed' | 'draft' | 'merged'
      readonly type: 'stop'
    }
  | { readonly reason: string; readonly type: 'wait' }
  | { readonly checks: readonly string[]; readonly type: 'diagnose_ci_failure' }
  | { readonly count: number; readonly type: 'handle_comments' }
  | { readonly type: 'converged' }

export interface WatchSnapshot {
  readonly actions: readonly WatchAction[]
  readonly answeredThreads: readonly AnsweredThread[]
  readonly bots: Omit<BotReviews, 'warnings'>
  /** Push only when true: no check is running and no bot review is working on the head. */
  readonly canPush: boolean
  readonly checks: {
    readonly failed: readonly CheckSummary[]
    readonly maxAttempts: number
    readonly needsApproval: readonly string[]
    readonly running: readonly string[]
    readonly total: number
  }
  readonly openItems: readonly OpenItem[]
  readonly pr: {
    readonly headSha: string
    readonly isDraft: boolean
    readonly number: number
    readonly reviewDecision: string | undefined
    readonly state: string
    readonly url: string
  }
  /** Changes when the head, a check, a bot review or the open items change; pass to `--since`. */
  readonly signature: string
  /** Not blocking: optional check failures, bot reviews that did not happen. */
  readonly warnings: readonly string[]
}

function stopReason(state: PullRequestState) {
  if (state.state === 'MERGED') {
    return 'merged'
  }
  if (state.state !== 'OPEN') {
    return 'closed'
  }
  return state.isDraft ? 'draft' : undefined
}

function deriveActions(input: {
  readonly approvals: readonly string[]
  readonly failed: readonly CheckSummary[]
  readonly items: number
  readonly running: readonly string[]
  readonly state: PullRequestState
  readonly total: number
}): WatchAction[] {
  const stop = stopReason(input.state)
  if (stop !== undefined) {
    return [{ reason: stop, type: 'stop' }]
  }
  if (input.total === 0) {
    return [{ reason: 'no checks reported for the head commit yet', type: 'wait' }]
  }
  const actions: WatchAction[] = []
  if (input.failed.length > 0) {
    actions.push({ checks: input.failed.map((check) => check.name), type: 'diagnose_ci_failure' })
  }
  if (input.items > 0) {
    actions.push({ count: input.items, type: 'handle_comments' })
  }
  if (input.running.length > 0) {
    actions.push({ reason: `in progress: ${input.running.join(', ')}`, type: 'wait' })
  }
  if (actions.length > 0) {
    return actions
  }
  return input.approvals.length > 0
    ? [{ reason: 'checks_need_approval', type: 'stop' }]
    : [{ type: 'converged' }]
}

function signatureOf(parts: readonly unknown[]) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, SIGNATURE_LENGTH)
}

export function buildSnapshot(state: PullRequestState, now: number): WatchSnapshot {
  const checks = summarizeChecks(state.checkRuns, state.statusContexts)
  const bots = botReviews(state, now)
  const { answeredThreads, openItems } = collectComments(state)
  const running = [
    ...checks.running.map((check) => check.name),
    ...bots.inProgress.map((bot) => `${bot} review`),
  ]
  const approvals = checks.needsApproval.map((check) => check.name)
  return {
    actions: deriveActions({
      approvals,
      failed: checks.failed,
      items: openItems.length,
      running,
      state,
      total: checks.total,
    }),
    answeredThreads,
    bots: { codex: bots.codex, copilot: bots.copilot, inProgress: bots.inProgress },
    canPush: running.length === 0,
    checks: {
      failed: checks.failed,
      maxAttempts: MAX_CHECK_ATTEMPTS,
      needsApproval: approvals,
      running: checks.running.map((check) => check.name),
      total: checks.total,
    },
    openItems,
    pr: {
      headSha: state.headSha,
      isDraft: state.isDraft,
      number: state.number,
      reviewDecision: state.reviewDecision,
      state: state.state,
      url: state.url,
    },
    signature: signatureOf([
      state.headSha,
      state.state,
      state.isDraft,
      [
        ...state.checkRuns.map((run) => `${String(run.id)}:${run.status}:${run.conclusion ?? ''}`),
      ].sort(),
      state.statusContexts.map((context) => `${context.context}:${context.state}`).sort(),
      bots.codex.status,
      bots.copilot,
      openItems.map((item) => `${item.url}:${String(item.replies.length)}`),
    ]),
    warnings: [
      ...checks.optionalFailed.map(
        (check) => `Optional check failed: ${check.name} (${check.url ?? 'no link'})`,
      ),
      ...bots.warnings,
    ],
  }
}

/** `--watch` without `--since` returns once the snapshot asks for anything beyond waiting. */
export function isActionable(snapshot: WatchSnapshot) {
  return snapshot.actions.some((action) => action.type !== 'wait')
}
