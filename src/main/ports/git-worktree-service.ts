import type {
  GitWorktreeCreatePayload,
  GitWorktreeListResult,
  GitWorktreeMutationResult,
  GitWorktreeRemovePayload,
} from '@shared/types/git'
import { Context, type Effect } from 'effect'

/**
 * `linked`: the top folder of a finished linked worktree of the repository, whose git dir was
 * registered for that folder. `locked`: such a worktree whose `git worktree add` has not finished,
 * or that someone locked. `not-a-worktree`: anything else, such as a plain folder, a folder inside
 * a worktree, or a copy of another worktree.
 */
export type LinkedWorktreeCheck = 'linked' | 'locked' | 'not-a-worktree'

export interface GitWorktreeServiceShape {
  readonly create: (
    projectPath: string,
    payload: GitWorktreeCreatePayload,
  ) => Effect.Effect<GitWorktreeMutationResult>
  readonly remove: (
    projectPath: string,
    payload: GitWorktreeRemovePayload,
  ) => Effect.Effect<GitWorktreeMutationResult>
  readonly validateRemoval: (
    projectPath: string,
    payload: GitWorktreeRemovePayload,
  ) => Effect.Effect<GitWorktreeMutationResult>
  readonly inspectLinkedWorktree: (
    projectPath: string,
    candidatePath: string,
  ) => Effect.Effect<LinkedWorktreeCheck, Error>
  /** Every worktree of the repository, as `git worktree list` reports them. */
  readonly list: (projectPath: string) => Effect.Effect<GitWorktreeListResult>
  /** Commits on a worktree's HEAD that no remote-tracking ref has; null when unknown. */
  readonly countUnpublishedCommits: (worktreePath: string) => Effect.Effect<number | null>
  /** The checkout the running app was started from (a development build), or null. */
  readonly applicationCheckout: () => Effect.Effect<string | null>
}

export class GitWorktreeService extends Context.Tag('@openwaggle/GitWorktreeService')<
  GitWorktreeService,
  GitWorktreeServiceShape
>() {}
