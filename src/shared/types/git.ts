export type GitFileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'unknown'

export interface GitChangedFile {
  readonly path: string
  readonly status: GitFileStatus
  readonly staged: boolean
  readonly additions: number
  readonly deletions: number
}

export interface GitStatusSummary {
  readonly branch: string
  readonly additions: number
  readonly deletions: number
  readonly filesChanged: number
  readonly changedFiles: readonly GitChangedFile[]
  readonly clean: boolean
  readonly ahead: number
  readonly behind: number
}

export interface GitCommitPayload {
  readonly message: string
  readonly amend: boolean
  readonly paths: readonly string[]
}

export const GIT_COMMIT_ERROR_CODES = [
  'not-git-repo',
  'nothing-to-commit',
  'merge-in-progress',
  'empty-message',
  'unknown',
] as const

export type GitCommitErrorCode = (typeof GIT_COMMIT_ERROR_CODES)[number]

export interface GitCommitSuccess {
  readonly ok: true
  readonly commitHash: string
  readonly summary: string
}

export interface GitCommitFailure {
  readonly ok: false
  readonly code: GitCommitErrorCode
  readonly message: string
}

export type GitCommitResult = GitCommitSuccess | GitCommitFailure
