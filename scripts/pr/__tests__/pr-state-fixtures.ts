import type {
  Actor,
  CheckRun,
  IssueComment,
  PullRequestState,
  Review,
  ReviewThread,
} from '../watch-model'

export const HEAD_SHA = 'a'.repeat(40)
export const OLD_SHA = 'b'.repeat(40)
export const VIEWER = 'maintainer'
export const NOW = Date.parse('2026-11-10T12:00:00Z')

export function person(login: string) {
  return { isBot: false, login } satisfies Actor
}

export function bot(login: string) {
  return { isBot: true, login } satisfies Actor
}

export function checkRun(overrides: Partial<CheckRun> = {}) {
  return {
    appSlug: 'github-actions',
    conclusion: 'SUCCESS',
    id: 100,
    isRequired: true,
    name: 'Unit Tests',
    runId: 7,
    status: 'COMPLETED',
    url: 'https://github.com/o/r/actions/runs/7/job/100',
    workflowName: 'CI',
    ...overrides,
  } satisfies CheckRun
}

export function issueComment(overrides: Partial<IssueComment> = {}) {
  const comment: IssueComment = {
    author: person('reviewer'),
    body: 'Please rename this.',
    createdAt: '2026-11-10T11:00:00Z',
    id: 1,
    reactions: [],
    updatedAt: '2026-11-10T11:00:00Z',
    url: 'https://github.com/o/r/pull/1#issuecomment-1',
    ...overrides,
  }
  return comment
}

export function review(overrides: Partial<Review> = {}) {
  return {
    author: person('reviewer'),
    body: '',
    commitSha: HEAD_SHA,
    id: 50,
    state: 'COMMENTED',
    submittedAt: '2026-11-10T11:00:00Z',
    url: 'https://github.com/o/r/pull/1#pullrequestreview-50',
    ...overrides,
  } satisfies Review
}

export function thread(overrides: Partial<ReviewThread> = {}) {
  return {
    comments: [
      {
        author: person('reviewer'),
        body: 'Off by one here.',
        createdAt: '2026-11-10T11:00:00Z',
        id: 900,
        url: 'https://github.com/o/r/pull/1#discussion_r900',
      },
    ],
    id: 'PRRT_1',
    isOutdated: false,
    isResolved: false,
    line: 12,
    path: 'src/main/x.ts',
    ...overrides,
  } satisfies ReviewThread
}

export function codexStateComment(input: {
  readonly sha: string
  readonly status: string
  readonly unresolved?: boolean
  readonly updatedAt?: string
}) {
  const state = {
    code_review: {
      commit_sha: input.sha,
      has_any_findings: input.unresolved ?? false,
      has_unresolved_findings: input.unresolved ?? false,
      status: input.status,
    },
  }
  return issueComment({
    author: bot('chatgpt-codex-connector'),
    body: `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 ${JSON.stringify(state)} -->\n\n## Codex Review Summary`,
    id: 2,
    updatedAt: input.updatedAt ?? '2026-11-10T11:30:00Z',
  })
}

export function prState(overrides: Partial<PullRequestState> = {}) {
  const result: PullRequestState = {
    checkRuns: [checkRun()],
    comments: [],
    headSha: HEAD_SHA,
    isDraft: false,
    number: 1,
    reactions: [],
    reviewDecision: undefined,
    reviewRequests: [],
    reviews: [],
    state: 'OPEN',
    statusContexts: [],
    threads: [],
    url: 'https://github.com/o/r/pull/1',
    viewer: VIEWER,
    ...overrides,
  }
  return result
}
