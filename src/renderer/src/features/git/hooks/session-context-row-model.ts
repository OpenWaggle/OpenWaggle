import type { SessionId } from '@shared/types/brand'
import type { SessionEnvironmentMode, VcsChangeRequest } from '@shared/types/git'
import type { SessionDetail } from '@shared/types/session'
import { resolveDefaultWorktreeBaseRef, type WorktreeSendPlan } from '../lib/worktree-send-plan'
import type { WorktreePlanOverride } from '../state/worktree-plan-store'

export interface UseSessionContextRowInput {
  readonly sessionId: SessionId | null
  readonly projectPath: string | null
  readonly isFirstMessage: boolean
  readonly session: Pick<
    SessionDetail,
    'environmentMode' | 'worktreePath' | 'worktreeBaseRef' | 'worktreeStartFromOrigin'
  > | null
  readonly defaultEnvironmentMode: SessionEnvironmentMode
}

export interface SessionContextRowState {
  readonly visible: boolean
  readonly editable: boolean
  readonly envMode: SessionEnvironmentMode
  readonly baseRef: string | null
  readonly worktreePath: string | null
  readonly startFromOrigin: boolean
  readonly branchNames: readonly string[]
  readonly changeRequests: readonly VcsChangeRequest[]
  readonly sendPlan: WorktreeSendPlan
  readonly setEnvMode: (mode: SessionEnvironmentMode) => void
  readonly setBaseRef: (baseRef: string) => void
  readonly setStartFromOrigin: (startFromOrigin: boolean) => void
  readonly loadChangeRequests: () => Promise<void>
  readonly checkoutChangeRequest: (headRef: string) => Promise<boolean>
  readonly recreateWorktree: () => Promise<boolean>
  readonly switchToLocalMode: () => void
}

export interface BranchListState {
  readonly currentBranch: string | null
  readonly names: readonly string[]
}

export const EMPTY_BRANCHES: BranchListState = { currentBranch: null, names: [] }

export function resolveEffectivePlan(
  override: WorktreePlanOverride | undefined,
  session: UseSessionContextRowInput['session'],
  defaultEnvironmentMode: SessionEnvironmentMode,
  currentBranch: string | null,
) {
  const defaultBaseRef =
    session?.worktreeBaseRef ?? resolveDefaultWorktreeBaseRef({ currentBranch })
  return {
    envMode: override?.envMode ?? session?.environmentMode ?? defaultEnvironmentMode,
    baseRef: override?.baseRef !== undefined ? override.baseRef : defaultBaseRef,
    startFromOrigin: override?.startFromOrigin ?? session?.worktreeStartFromOrigin ?? false,
  }
}
