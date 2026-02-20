import type { GitBranchListResult, GitBranchMutationResult } from '@shared/types/git'
import type { OrchestrationEventPayload, OrchestrationRunRecord } from '@shared/types/orchestration'

export interface GitProps {
  readonly gitBranch?: string | null
  readonly gitBranches?: GitBranchListResult | null
  readonly isBranchActionRunning?: boolean
  readonly onCheckoutBranch?: (name: string) => Promise<GitBranchMutationResult>
  readonly onCreateBranch?: (
    name: string,
    startPoint?: string,
    checkout?: boolean,
  ) => Promise<GitBranchMutationResult>
  readonly onRenameBranch?: (from: string, to: string) => Promise<GitBranchMutationResult>
  readonly onDeleteBranch?: (name: string, force?: boolean) => Promise<GitBranchMutationResult>
  readonly onSetBranchUpstream?: (
    name: string,
    upstream: string,
  ) => Promise<GitBranchMutationResult>
  readonly onRefreshGit?: () => void
  readonly isRefreshingGit?: boolean
}

export interface OrchestrationProps {
  readonly orchestrationRuns?: readonly OrchestrationRunRecord[]
  readonly orchestrationEvents?: readonly OrchestrationEventPayload[]
  readonly onCancelOrchestrationRun?: (runId: string) => Promise<void> | void
}
