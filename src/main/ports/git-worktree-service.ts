import type {
  GitWorktreeCreatePayload,
  GitWorktreeMutationResult,
  GitWorktreeRemovePayload,
} from '@shared/types/git'
import { Context, type Effect } from 'effect'

/**
 * `linked`: a finished linked worktree of the repository. `locked`: one `git worktree add` has
 * not finished, or that someone locked. `not-a-worktree`: anything else, such as a plain folder.
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
}

export class GitWorktreeService extends Context.Tag('@openwaggle/GitWorktreeService')<
  GitWorktreeService,
  GitWorktreeServiceShape
>() {}
