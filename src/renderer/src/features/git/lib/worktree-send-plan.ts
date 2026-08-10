import type { SessionEnvironmentMode } from '@shared/types/git'

/**
 * Pure send-gating logic for the composer context strip (WS1b, ADR 0010).
 *
 * Mirrors T3Code's ChatView worktree gate: on the first message of a
 * worktree-mode session that has no Session worktree yet, a Worktree base ref
 * must be resolvable or the send is blocked (never silently falls back to
 * running in the opened checkout).
 */
export interface WorktreeSendPlanInput {
  readonly isFirstMessage: boolean
  readonly envMode: SessionEnvironmentMode
  readonly hasWorktree: boolean
  readonly baseRef: string | null
}

export type WorktreeSendPlan =
  | { readonly kind: 'proceed' }
  | { readonly kind: 'create-worktree'; readonly baseRef: string }
  | { readonly kind: 'blocked'; readonly reason: string }

export const WORKTREE_BASE_REF_REQUIRED = 'Select a base branch before sending in worktree mode.'

/**
 * Decide whether a send proceeds directly, must first birth a Session worktree
 * off a chosen base ref, or is blocked because no base ref is resolvable.
 */
export function resolveWorktreeSendPlan(input: WorktreeSendPlanInput): WorktreeSendPlan {
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
