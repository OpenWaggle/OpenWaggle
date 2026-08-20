import { existsSync } from 'node:fs'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import type { GitWorktreeMutationResult, SessionWorktreeCheck } from '@shared/types/git'
import * as Effect from 'effect/Effect'
import { typedHandle } from '../typed-ipc'
import { projectPathSchema } from './shared'
import { invalidateGitStatusCache } from './status-cache'
import { createGitWorktree, listGitWorktrees, removeGitWorktree } from './worktree-service'

export const worktreeCreatePayloadSchema = Schema.Struct({
  path: Schema.String,
  branch: Schema.String,
  baseRef: Schema.String,
})

export const worktreeRemovePayloadSchema = Schema.Struct({
  path: Schema.String,
  force: Schema.optional(Schema.Boolean),
})

export function registerGitWorktreeHandlers(): void {
  typedHandle('git:worktrees:list', (_event, rawPath: unknown) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
      return yield* Effect.promise(() => listGitWorktrees(projectPath))
    }),
  )

  /*
   * Existence check for a session's recorded worktree. Read-only and cheap, so the
   * composer can gate a send on it: a worktree that vanished must stop the send and
   * let the user choose, not hand the agent a fresh empty tree.
   */
  typedHandle('git:worktrees:check', (_event, rawPath: unknown) =>
    Effect.sync(() => {
      const worktreePath = typeof rawPath === 'string' ? rawPath.trim() : ''
      if (worktreePath.length === 0) {
        return { exists: false, recorded: false } satisfies SessionWorktreeCheck
      }
      return { exists: existsSync(worktreePath), recorded: true } satisfies SessionWorktreeCheck
    }),
  )

  typedHandle('git:worktrees:create', (_event, rawPath: unknown, rawPayload: unknown) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
      const payload = decodeUnknownOrThrow(worktreeCreatePayloadSchema, rawPayload)
      const result = (yield* Effect.promise(() =>
        createGitWorktree(projectPath, payload),
      )) satisfies GitWorktreeMutationResult
      // The new tree has no cached status yet, and the repository's worktree list
      // changed, so invalidate both the new path and the repository.
      if (result.ok) {
        invalidateGitStatusCache(payload.path)
        invalidateGitStatusCache(projectPath)
      }
      return result
    }),
  )

  typedHandle('git:worktrees:remove', (_event, rawPath: unknown, rawPayload: unknown) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
      const payload = decodeUnknownOrThrow(worktreeRemovePayloadSchema, rawPayload)
      const result = (yield* Effect.promise(() =>
        removeGitWorktree(projectPath, payload),
      )) satisfies GitWorktreeMutationResult
      if (result.ok) {
        invalidateGitStatusCache(payload.path)
        invalidateGitStatusCache(projectPath)
      }
      return result
    }),
  )
}
