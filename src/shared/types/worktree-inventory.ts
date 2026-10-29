import type { WorkspacePreparation } from './workspace-preparation'
import type { WorktreeRemovalBlocker, WorktreeSessionUsage } from './worktree-usage'

/** The archive ages Automatic worktree removal offers (ADR 0060). */
export const AUTOMATIC_WORKTREE_REMOVAL_DAY_OPTIONS = [7, 14, 30, 60, 90] as const
export type AutomaticWorktreeRemovalDays = (typeof AUTOMATIC_WORKTREE_REMOVAL_DAY_OPTIONS)[number]

export function isAutomaticWorktreeRemovalDays(
  value: unknown,
): value is AutomaticWorktreeRemovalDays {
  return AUTOMATIC_WORKTREE_REMOVAL_DAY_OPTIONS.some((days) => days === value)
}

/** Automatic worktree removal (CONTEXT.md): off until the user turns it on. */
export interface AutomaticWorktreeRemovalSettings {
  readonly enabled: boolean
  /** How long every Session bound to a worktree has been archived before it is removed. */
  readonly archivedDays: AutomaticWorktreeRemovalDays
}

export const DEFAULT_AUTOMATIC_WORKTREE_REMOVAL: AutomaticWorktreeRemovalSettings = {
  enabled: false,
  archivedDays: 30,
}

/** A Session that works in a worktree, with its Archive time. */
export type WorktreeInventorySession = WorktreeSessionUsage

/**
 * What keeps a worktree out of "Safe to remove". Each one has its own way out on the page:
 * archiving the Sessions, discarding the changes, pushing or accepting the loss of commits, or
 * recovering the failed cleanup.
 */
export type WorktreeAttention =
  /** Sessions that are not archived work in it; Archive & remove archives them first. */
  | { readonly kind: 'open-sessions'; readonly count: number }
  | { readonly kind: 'uncommitted-changes'; readonly count: number }
  /** Commits on its HEAD that no remote has. The branch is kept either way. */
  | { readonly kind: 'unpublished-commits'; readonly count: number }
  | { readonly kind: 'cleanup-failed' }
  | { readonly kind: 'locked' }
  /** Git could not report its changes or commits, so nothing can be promised about it. */
  | { readonly kind: 'unknown-state' }
  /** Created outside OpenWaggle: nothing records what its ignored files are for. */
  | { readonly kind: 'unmanaged' }
  /** In the managed worktree folder but not recorded here: another profile may be using it. */
  | { readonly kind: 'unrecorded' }

export type WorktreeInventoryGroup = 'safe' | 'decide' | 'in-use'

/** Why Automatic worktree removal keeps a worktree it would otherwise remove. */
export type AutomaticWorktreeRemovalKeptReason =
  | 'in-use'
  | 'uncommitted-changes'
  | 'unpublished-commits'
  | 'cleanup-failed'
  | 'locked'
  | 'unknown-state'

/** What Automatic worktree removal will do with one worktree, under the current setting. */
export type AutomaticWorktreeRemovalDecision =
  /** The rule is off, or the worktree is not one it removes (no Session, not managed). */
  | { readonly kind: 'not-applicable' }
  /** Every bound Session is archived, but not yet for the chosen number of days. */
  | { readonly kind: 'waiting'; readonly dueAt: number }
  | { readonly kind: 'due'; readonly dueAt: number }
  | {
      readonly kind: 'kept'
      readonly dueAt: number
      readonly reason: AutomaticWorktreeRemovalKeptReason
    }

/** A Workspace cleanup that failed and retained the worktree (ADR 0038), as removal recovers it. */
export interface WorktreeCleanupFailure {
  readonly preparation: WorkspacePreparation
  readonly generationMismatch?: boolean
  readonly generationMismatchMessage?: string
}

/** One worktree on Settings > Worktrees. Main checkouts are never listed. */
export interface WorktreeInventoryEntry {
  readonly path: string
  /** The repository's main checkout, which removal runs from. */
  readonly projectPath: string
  readonly branch: string | null
  /** Recorded by this profile as a managed Workspace. */
  readonly managed: boolean
  readonly sessions: readonly WorktreeInventorySession[]
  readonly blockers: readonly WorktreeRemovalBlocker[]
  readonly uncommittedChangeCount: number | null
  readonly unpublishedCommitCount: number | null
  /** The latest Archive time when every Session working in it is archived; null otherwise. */
  readonly archivedAt: number | null
  readonly cleanupFailure?: WorktreeCleanupFailure
  readonly group: WorktreeInventoryGroup
  /** What a removal would end or lose; empty for a worktree that is safe to remove. */
  readonly attention: readonly WorktreeAttention[]
  readonly automaticRemoval: AutomaticWorktreeRemovalDecision
}

export interface WorktreeInventoryProject {
  /** The main checkout. */
  readonly projectPath: string
  readonly name: string
  /** The project open in the app. */
  readonly opened: boolean
}

export interface WorktreeInventory {
  readonly projects: readonly WorktreeInventoryProject[]
  readonly entries: readonly WorktreeInventoryEntry[]
  /** Projects or checks that could not be read; the rest of the list is still accurate. */
  readonly problems: readonly string[]
}

/** Reclaimable space (CONTEXT.md) of one worktree. */
export interface WorktreeReclaimableSpace {
  readonly path: string
  readonly reclaimableBytes: number
  readonly measuredAt: number
}

/** `worktrees:archive-and-remove`: archive every Session working in it, then remove it. */
export interface WorktreeArchiveAndRemovePayload {
  readonly path: string
  /**
   * Every Session the confirmation named. The Host refuses when the Sessions working in the
   * worktree have changed since, so it never archives one the user was not shown.
   */
  readonly sessionIds: readonly string[]
  /** Override Git's lock. Uncommitted changes always keep the worktree: this never discards. */
  readonly force?: boolean
  /**
   * Archive the Sessions and stop there ("Archive Sessions", for a worktree that may have
   * changes): the worktree is kept whatever its state, for an explicit decision later.
   */
  readonly keepWorktree?: boolean
}

export interface AutomaticWorktreeRemovalRemoved {
  readonly path: string
  readonly projectPath: string
  readonly branch: string | null
  readonly sessionTitles: readonly string[]
  /** From the last measurement; null when it had not been measured. */
  readonly reclaimableBytes: number | null
}

export interface AutomaticWorktreeRemovalFailure {
  readonly path: string
  readonly projectPath: string
  readonly message: string
}

/** One pass of Automatic worktree removal. */
export interface AutomaticWorktreeRemovalRun {
  readonly id: string
  readonly startedAt: number
  readonly finishedAt: number
  /** The rule's days when it ran; a number, so a record outlives a change to the choices. */
  readonly archivedDays: number
  readonly removed: readonly AutomaticWorktreeRemovalRemoved[]
  readonly failed: readonly AutomaticWorktreeRemovalFailure[]
}

export interface AutomaticWorktreeRemovalLog {
  /** When the rule last checked, whether or not it found anything; null before the first check. */
  readonly lastCheckedAt: number | null
  /** Runs that removed or failed to remove something, newest first. */
  readonly runs: readonly AutomaticWorktreeRemovalRun[]
  /** The newest run that removed something and has not been announced; null when none. */
  readonly unannouncedRunId: string | null
}
