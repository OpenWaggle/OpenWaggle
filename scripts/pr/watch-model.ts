/** Normalised GitHub state of one PR, as `pr:watch` reads it. Bot logins lose their `[bot]` suffix. */

export interface Actor {
  readonly isBot: boolean
  readonly login: string
}

export interface CheckRun {
  readonly appSlug: string | undefined
  readonly conclusion: string | undefined
  /** The check run id; for GitHub Actions it is also the job id `gh run rerun --job` takes. */
  readonly id: number
  readonly isRequired: boolean
  readonly name: string
  readonly runId: number | undefined
  readonly status: string
  readonly url: string | undefined
  readonly workflowName: string | undefined
}

export interface StatusContext {
  readonly context: string
  readonly isRequired: boolean
  readonly state: string
  readonly url: string | undefined
}

export interface ThreadComment {
  readonly author: Actor
  readonly body: string
  readonly createdAt: string
  readonly id: number
  readonly url: string
}

export interface ReviewThread {
  readonly comments: readonly ThreadComment[]
  readonly id: string
  readonly isOutdated: boolean
  readonly isResolved: boolean
  readonly line: number | undefined
  readonly path: string
}

export interface Reaction {
  readonly content: string
  readonly logins: readonly string[]
}

export interface IssueComment {
  readonly author: Actor
  readonly body: string
  readonly createdAt: string
  readonly id: number
  readonly reactions: readonly Reaction[]
  readonly updatedAt: string
  readonly url: string
}

export interface Review {
  readonly author: Actor
  readonly body: string
  readonly commitSha: string | undefined
  readonly id: number
  readonly state: string
  readonly submittedAt: string | undefined
  readonly url: string
}

export interface PullRequestState {
  readonly checkRuns: readonly CheckRun[]
  readonly comments: readonly IssueComment[]
  readonly headSha: string
  readonly isDraft: boolean
  readonly number: number
  readonly reactions: readonly Reaction[]
  readonly reviewDecision: string | undefined
  readonly reviewRequests: readonly Actor[]
  readonly reviews: readonly Review[]
  readonly state: string
  readonly statusContexts: readonly StatusContext[]
  readonly threads: readonly ReviewThread[]
  readonly url: string
  readonly viewer: string
}
