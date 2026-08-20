/**
 * Pure birth-path policy for Session worktrees (ADR 0010).
 *
 * Main-process copy of the composer's send guard ("Select a base branch before sending in New
 * worktree mode"). Kept pure so it can be unit-tested and reused by the send
 * path without touching git or persistence.
 */
import type { SessionEnvironmentMode } from '@shared/types/git'

export type WorktreeSendPlan =
  | { readonly kind: 'use-checkout' }
  | { readonly kind: 'create-worktree'; readonly baseRef: string }
  | { readonly kind: 'blocked'; readonly reason: 'base-ref-required' }

export interface ResolveWorktreeSendPlanInput {
  readonly mode: SessionEnvironmentMode
  /** Base ref chosen for the session's worktree, if any. */
  readonly baseRef: string | null
  /** Path of an already-created Session worktree for this session, if any. */
  readonly existingWorktreePath: string | null
}

/**
 * Decides what should happen to the working tree when a session sends a message.
 * - `local` mode always uses the opened checkout.
 * - `worktree` mode with an existing worktree reuses it.
 * - `worktree` mode without a worktree requires a base ref, else it is blocked.
 */
export function resolveWorktreeSendPlan(input: ResolveWorktreeSendPlanInput): WorktreeSendPlan {
  if (input.mode === 'local') return { kind: 'use-checkout' }
  if (input.existingWorktreePath?.trim()) return { kind: 'use-checkout' }

  const baseRef = input.baseRef?.trim()
  if (!baseRef) return { kind: 'blocked', reason: 'base-ref-required' }

  return { kind: 'create-worktree', baseRef }
}
