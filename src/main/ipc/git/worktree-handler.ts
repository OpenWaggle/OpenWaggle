import { existsSync } from 'node:fs'
import { decodeUnknownOrThrow } from '@shared/schema'
import type { SessionWorktreeCheck } from '@shared/types/git'
import * as Effect from 'effect/Effect'
import {
  createHostUiWorktree,
  removeHostUiWorktree,
  worktreeCreatePayloadSchema,
  worktreeRemovePayloadSchema,
} from '../../application/host-ui-worktree-operation'
import { hostHandle, typedHandle } from '../typed-ipc'
import { projectPathSchema } from './shared'
import { listGitWorktrees } from './worktree-service'

export { worktreeCreatePayloadSchema, worktreeRemovePayloadSchema }

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

  hostHandle('git:worktrees:create', (_event, rawPath: unknown, rawPayload: unknown) =>
    createHostUiWorktree(rawPath, rawPayload),
  )

  hostHandle('git:worktrees:remove', (_event, rawPath: unknown, rawPayload: unknown) =>
    removeHostUiWorktree(rawPath, rawPayload),
  )
}
