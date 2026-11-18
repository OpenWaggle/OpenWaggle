import type { WorkingPath } from '@shared/types/brand'
import type {
  GitActionProgressEvent,
  GitBranchInfo,
  GitRunStackedActionOptions,
  GitRunStackedActionResult,
  GitStackedAction,
  GitStatusSummary,
  VcsStatus,
} from '@shared/types/git'
import type { KeyboardEvent } from 'react'
import type {
  CommitBranchTarget,
  CommitCommandAction,
  CommitRemoteState,
} from '../lib/commit-or-push-model'

export interface CommitOrPushRepositoryContext {
  readonly sessionTitle: string
  readonly workingPath: WorkingPath
  readonly gitStatus: GitStatusSummary
  readonly vcsStatus: VcsStatus | null
  readonly remoteState: CommitRemoteState
  readonly branches: readonly GitBranchInfo[]
}

export interface CommitOrPushOperation {
  readonly running: boolean
  readonly progress: GitActionProgressEvent | null
  readonly run: (
    action: GitStackedAction,
    options: Partial<GitRunStackedActionOptions>,
  ) => Promise<GitRunStackedActionResult | undefined>
  readonly stop: () => Promise<boolean>
}

export interface CommitOrPushDialogProps {
  readonly repository: CommitOrPushRepositoryContext
  readonly operation: CommitOrPushOperation
  readonly onClose: () => void
}

export interface CommitOrPushDialogController {
  readonly target: CommitBranchTarget
  readonly branchName: string
  readonly message: string
  readonly includeUnstaged: boolean
  readonly validationChecking: boolean
  readonly branchReason: string | null
  readonly error: string | null
  readonly stopRequested: boolean
  readonly stats: {
    readonly staged: {
      readonly filesChanged: number
      readonly additions: number
      readonly deletions: number
    }
    readonly unstaged: {
      readonly filesChanged: number
      readonly additions: number
      readonly deletions: number
    }
  }
  readonly actions: readonly CommitCommandAction[]
  readonly primary: CommitCommandAction | null
  readonly origin: string
  readonly setTarget: (target: CommitBranchTarget) => void
  readonly setBranchName: (branchName: string) => void
  readonly setMessage: (message: string) => void
  readonly setIncludeUnstaged: (include: boolean) => void
  readonly run: (action: GitStackedAction) => Promise<void>
  readonly stop: () => Promise<void>
  readonly onKeyDown: (event: KeyboardEvent<HTMLFormElement>) => void
}
