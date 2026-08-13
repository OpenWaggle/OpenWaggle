import type { SessionEnvironmentMode } from '@shared/types/git'

/**
 * Pure send-gating logic for the composer context strip (WS1b, ADR 0010).
 *
 * On the first message of a worktree-mode session that has no Session worktree
 * yet, a Worktree base ref must be resolvable or the send is blocked. It never
 * silently falls back to running in the opened checkout: that would put the agent
 * in the user's real working tree while the UI claims isolation.
 */
export interface WorktreeSendPlanInput {
  readonly isFirstMessage: boolean
  readonly envMode: SessionEnvironmentMode
  readonly hasWorktree: boolean
  readonly baseRef: string | null
  /**
   * False when a worktree path is recorded for this session but no longer exists on
   * disk. Undefined while unknown (not yet checked), which must not block a send.
   */
  readonly worktreeExists?: boolean | undefined
}

export type WorktreeSendPlan =
  | { readonly kind: 'proceed' }
  | { readonly kind: 'create-worktree'; readonly baseRef: string }
  | { readonly kind: 'blocked'; readonly reason: string }
  /**
   * The recorded worktree is gone. Distinct from `blocked` because the user is offered
   * a choice rather than merely told no.
   */
  | { readonly kind: 'worktree-missing'; readonly reason: string }

export const WORKTREE_BASE_REF_REQUIRED = 'Select a base branch before sending in worktree mode.'

export const WORKTREE_MISSING_REASON =
  "This session's worktree no longer exists. Recreate it, or switch this session to the current checkout."

/**
 * Decide whether a send proceeds directly, must first birth a Session worktree
 * off a chosen base ref, or is blocked because no base ref is resolvable.
 */
export function resolveWorktreeSendPlan(input: WorktreeSendPlanInput): WorktreeSendPlan {
  /*
   * A worktree that vanished stops the send. Recreating it silently would hand the
   * agent an empty tree while the session's earlier work is gone, with nothing in the
   * UI saying so, so the user chooses: recreate, or run in the opened checkout.
   */
  if (input.envMode === 'worktree' && input.hasWorktree && input.worktreeExists === false) {
    return { kind: 'worktree-missing', reason: WORKTREE_MISSING_REASON }
  }

  const shouldCreateWorktree =
    input.isFirstMessage && input.envMode === 'worktree' && !input.hasWorktree
  if (!shouldCreateWorktree) return { kind: 'proceed' }

  const baseRef = input.baseRef?.trim()
  if (!baseRef) return { kind: 'blocked', reason: WORKTREE_BASE_REF_REQUIRED }
  return { kind: 'create-worktree', baseRef }
}

/**
 * The default Worktree base ref for a fresh worktree-mode session: the current
 * branch when resolvable, otherwise null (which blocks send until chosen).
 */
export function resolveDefaultWorktreeBaseRef(
  branchList: { readonly currentBranch: string | null } | null,
): string | null {
  return branchList?.currentBranch?.trim() || null
}
