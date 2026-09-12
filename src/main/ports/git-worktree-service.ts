import type {
  GitWorktreeCreatePayload,
  GitWorktreeMutationResult,
  GitWorktreeRemovePayload,
} from '@shared/types/git'
import { Context, type Effect } from 'effect'

export interface GitWorktreeServiceShape {
  readonly create: (
    projectPath: string,
    payload: GitWorktreeCreatePayload,
  ) => Effect.Effect<GitWorktreeMutationResult>
  readonly remove: (
    projectPath: string,
    payload: GitWorktreeRemovePayload,
  ) => Effect.Effect<GitWorktreeMutationResult>
}

export class GitWorktreeService extends Context.Tag('@openwaggle/GitWorktreeService')<
  GitWorktreeService,
  GitWorktreeServiceShape
>() {}
