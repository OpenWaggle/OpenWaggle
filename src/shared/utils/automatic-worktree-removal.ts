import type {
  AutomaticWorktreeRemovalDecision,
  AutomaticWorktreeRemovalKeptReason,
  AutomaticWorktreeRemovalRun,
  AutomaticWorktreeRemovalSettings,
  WorktreeAttention,
  WorktreeInventoryEntry,
} from '@shared/types/worktree-inventory'

const MS_PER_DAY = 86_400_000

/** The facts of a classified worktree that the rule reads. */
export type AutomaticWorktreeRemovalCandidate = Pick<
  WorktreeInventoryEntry,
  'managed' | 'archivedAt' | 'group' | 'blockers' | 'attention'
>

/** The order reasons are reported in: the one a person must act on first comes first. */
const KEPT_REASONS: readonly (AutomaticWorktreeRemovalKeptReason & WorktreeAttention['kind'])[] = [
  'cleanup-failed',
  'unknown-state',
  'uncommitted-changes',
  'unpublished-commits',
  'locked',
]

function keptReason(
  candidate: AutomaticWorktreeRemovalCandidate,
): AutomaticWorktreeRemovalKeptReason | null {
  if (candidate.group === 'in-use' || candidate.blockers.length > 0) return 'in-use'
  return (
    KEPT_REASONS.find((reason) =>
      candidate.attention.some((attention) => attention.kind === reason),
    ) ?? null
  )
}

/**
 * Automatic worktree removal (CONTEXT.md, ADR 0060): a managed worktree whose every Session has
 * been archived for the chosen number of days is removed, unless that would lose work only it
 * holds. A worktree no Session works in has no archive time, so the rule never removes it. The
 * Settings preview calls this with a rule the user has not saved yet.
 */
export function decideAutomaticWorktreeRemoval(
  candidate: AutomaticWorktreeRemovalCandidate,
  rule: AutomaticWorktreeRemovalSettings,
  now: number,
): AutomaticWorktreeRemovalDecision {
  if (!rule.enabled || !candidate.managed || candidate.archivedAt === null) {
    return { kind: 'not-applicable' }
  }
  const dueAt = candidate.archivedAt + rule.archivedDays * MS_PER_DAY
  if (now < dueAt) return { kind: 'waiting', dueAt }
  const reason = keptReason(candidate)
  return reason === null ? { kind: 'due', dueAt } : { kind: 'kept', dueAt, reason }
}

/** The space a run freed, or null when none of its removals was measured. */
export function automaticRemovalFreedBytes(run: AutomaticWorktreeRemovalRun) {
  const measured = run.removed.flatMap((removed) =>
    removed.reclaimableBytes === null ? [] : [removed.reclaimableBytes],
  )
  return measured.length === 0 ? null : measured.reduce((sum, bytes) => sum + bytes, 0)
}
