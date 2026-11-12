import { Schema } from 'effect'
import type { IssueComment, PullRequestState } from './watch-model'

const CODEX_LOGIN = 'chatgpt-codex-connector'
const CODEX_STATE_PATTERN = /<!--\s*codex-review-state:v1\s+(\{[\s\S]*?\})\s*-->/
const CODEX_USAGE_LIMIT_PATTERN = /reached your Codex usage limits/i
const CODEX_FINISHED_STATUSES = new Set([
  'cancelled',
  'canceled',
  'completed',
  'error',
  'failed',
  'skipped',
])
/** A usage-limit reply lands next to the failed state update; this window pairs the two. */
const USAGE_LIMIT_PAIRING_MS = 10 * 60 * 1000
/** A review still "running" after this long has stalled; it stops holding pushes back. */
const STALLED_REVIEW_MS = 45 * 60 * 1000
const COPILOT_LOGIN_PATTERN = /copilot/i
const SHORT_SHA_LENGTH = 12

export type CodexStatus =
  | 'clean'
  | 'failed'
  | 'findings'
  | 'none'
  | 'running'
  | 'stalled'
  | 'usage_limited'

export interface BotReviews {
  readonly codex: {
    /** The latest attempt when it covered an older commit, for the report. */
    readonly lastAttempt?: { readonly outcome: CodexStatus; readonly sha: string }
    readonly status: CodexStatus
  }
  readonly copilot: 'none' | 'requested' | 'reviewed' | 'reviewed_older_commit'
  /** Bot reviews still working on the head; a push now would make them review a dead commit. */
  readonly inProgress: readonly string[]
  readonly warnings: readonly string[]
}

interface CodexState {
  readonly commitSha: string | undefined
  readonly hasUnresolvedFindings: boolean
  readonly status: string | undefined
  readonly updatedAt: string
}

const CodexStateSchema = Schema.parseJson(
  Schema.Struct({
    code_review: Schema.Struct({
      commit_sha: Schema.optionalWith(Schema.NullOr(Schema.String), { exact: true }),
      has_unresolved_findings: Schema.optionalWith(Schema.NullOr(Schema.Boolean), { exact: true }),
      status: Schema.optionalWith(Schema.NullOr(Schema.String), { exact: true }),
    }),
  }),
)

function parseCodexState(comment: IssueComment) {
  const json = CODEX_STATE_PATTERN.exec(comment.body)?.[1]
  if (json === undefined) {
    return undefined
  }
  try {
    const review = Schema.decodeUnknownSync(CodexStateSchema)(json).code_review
    return {
      commitSha: review.commit_sha ?? undefined,
      hasUnresolvedFindings: review.has_unresolved_findings === true,
      status: review.status ?? undefined,
      updatedAt: comment.updatedAt,
    }
  } catch {
    return undefined
  }
}

/** Codex comments the state marker or a usage-limit reply belong to; everything else is an item. */
export function isCodexReport(comment: IssueComment) {
  return (
    comment.author.login === CODEX_LOGIN &&
    (CODEX_STATE_PATTERN.test(comment.body) || CODEX_USAGE_LIMIT_PATTERN.test(comment.body))
  )
}

function hasCodexReaction(state: PullRequestState, content: string) {
  return state.reactions.some(
    (reaction) => reaction.content === content && reaction.logins.includes(CODEX_LOGIN),
  )
}

/** How a finished Codex review attempt ended, whichever commit it covered. */
function attemptOutcome(attempt: CodexState, codexComments: readonly IssueComment[]) {
  if (attempt.status === 'completed') {
    return attempt.hasUnresolvedFindings ? ('findings' as const) : ('clean' as const)
  }
  const updatedAt = Date.parse(attempt.updatedAt)
  const limited = codexComments.some(
    (comment) =>
      CODEX_USAGE_LIMIT_PATTERN.test(comment.body) &&
      Math.abs(Date.parse(comment.createdAt) - updatedAt) <= USAGE_LIMIT_PAIRING_MS,
  )
  return limited ? ('usage_limited' as const) : ('failed' as const)
}

function codexReview(state: PullRequestState, now: number) {
  const codexComments = state.comments.filter((comment) => comment.author.login === CODEX_LOGIN)
  const attempt = codexComments.map(parseCodexState).findLast((parsed) => parsed !== undefined)
  const forHead = attempt?.commitSha === state.headSha ? attempt : undefined
  const busy = forHead !== undefined && !CODEX_FINISHED_STATUSES.has(forHead.status ?? '')
  if (busy || hasCodexReaction(state, 'EYES')) {
    const since = forHead === undefined ? now : Date.parse(forHead.updatedAt)
    return {
      status: now - since > STALLED_REVIEW_MS ? 'stalled' : 'running',
    } satisfies BotReviews['codex']
  }
  if (forHead !== undefined) {
    return { status: attemptOutcome(forHead, codexComments) } satisfies BotReviews['codex']
  }
  if (attempt?.commitSha === undefined) {
    // 👍 on the PR is how Codex says a review found nothing; it names no commit.
    return {
      status: hasCodexReaction(state, 'THUMBS_UP') ? 'clean' : 'none',
    } satisfies BotReviews['codex']
  }
  return {
    lastAttempt: { outcome: attemptOutcome(attempt, codexComments), sha: attempt.commitSha },
    status: 'none',
  } satisfies BotReviews['codex']
}

function copilotStatus(state: PullRequestState) {
  if (state.reviewRequests.some((reviewer) => COPILOT_LOGIN_PATTERN.test(reviewer.login))) {
    return 'requested' as const
  }
  const reviews = state.reviews.filter(
    (review) => review.author.isBot && COPILOT_LOGIN_PATTERN.test(review.author.login),
  )
  if (reviews.some((review) => review.commitSha === state.headSha)) {
    return 'reviewed' as const
  }
  return reviews.length > 0 ? ('reviewed_older_commit' as const) : ('none' as const)
}

const CODEX_WARNINGS: Partial<Record<CodexStatus, string>> = {
  failed: 'The Codex review of the head failed; no Codex review happened for this commit.',
  stalled:
    'The Codex review has looked busy for over 45 minutes; treated as stalled, not waited on.',
  usage_limited: 'Codex hit its usage limits, so no Codex review happened for this commit.',
}

function codexWarnings(codex: BotReviews['codex']) {
  const warning = CODEX_WARNINGS[codex.status]
  if (warning !== undefined) {
    return [warning]
  }
  if (codex.lastAttempt?.outcome === 'usage_limited') {
    return [
      `No Codex review covers the head; the last attempt (${codex.lastAttempt.sha.slice(0, SHORT_SHA_LENGTH)}) hit usage limits.`,
    ]
  }
  return []
}

export function botReviews(state: PullRequestState, now: number) {
  const codex = codexReview(state, now)
  const copilot = copilotStatus(state)
  const reviews: BotReviews = {
    codex,
    copilot,
    inProgress: [
      ...(codex.status === 'running' ? ['codex'] : []),
      ...(copilot === 'requested' ? ['copilot'] : []),
    ],
    warnings: codexWarnings(codex),
  }
  return reviews
}
