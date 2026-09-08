import { existsSync } from 'node:fs'
import path from 'node:path'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { SessionId } from '@shared/types/brand'
import type { GitWorktreeMutationResult, SessionWorktreeCheck } from '@shared/types/git'
import * as Effect from 'effect/Effect'
import { createLogger } from '../../logger'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { TerminalService } from '../../ports/terminal-service'
import { resolveSessionWorktreeBranch } from '../../services/git/session-branch-resolution'
import { typedHandle } from '../typed-ipc'
import { projectPathSchema } from './shared'
import { invalidateGitStatusCache } from './status-cache'
import { createGitWorktree, listGitWorktrees, removeGitWorktree } from './worktree-service'

const logger = createLogger('worktree-handler')

const absoluteWorktreePathSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.filter((value) => path.isAbsolute(value) || 'Worktree path must be absolute'),
)

export const worktreeCreatePayloadSchema = Schema.Struct({
  path: absoluteWorktreePathSchema,
  branch: Schema.String,
  baseRef: Schema.String,
  /**
   * Set when the worktree belongs to a session, so main - not the caller - decides the branch name.
   *
   * Session branches follow a convention with a legacy form, and the renderer's recreate action
   * derived the current name itself: recreating a legacy session's tree created a fresh branch at
   * the base ref and left the agent's commits on the old one.
   */
  sessionId: Schema.optional(Schema.String),
})

export const worktreeRemovePayloadSchema = Schema.Struct({
  path: absoluteWorktreePathSchema,
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
      const sessionId = payload.sessionId
      if (sessionId !== undefined) {
        /*
         * Record Setup intent before Git creates the replacement. If the app exits after Git
         * succeeds, the next send still sees the pending generation and dispatches Setup. The
         * repository also verifies that this is the Session's recorded missing-tree path.
         */
        if (existsSync(payload.path)) {
          return yield* Effect.fail(
            new Error('The Session worktree already exists and does not need recreation.'),
          )
        }
        const sessions = yield* SessionProjectionRepository
        yield* sessions.resetWorktreeSetup(SessionId(sessionId), payload.path)
      }
      const branch =
        sessionId === undefined
          ? payload.branch
          : yield* Effect.promise(() => resolveSessionWorktreeBranch(projectPath, sessionId))
      const result = (yield* Effect.promise(() =>
        createGitWorktree(projectPath, { ...payload, branch }),
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
      const terminals = yield* TerminalService
      return yield* terminals.runWithMutationFence(
        { kind: 'path', directoryPath: payload.path },
        Effect.gen(function* () {
          // Stop every shell before Git can make its working path unreachable,
          // but retain replay until Git accepts removal. The outer path fence
          // rejects new opens until Git and post-success cleanup both finish.
          yield* terminals.closeAllUnderPath(payload.path, false)
          const result = (yield* Effect.promise(() =>
            removeGitWorktree(projectPath, payload),
          )) satisfies GitWorktreeMutationResult
          if (result.ok) {
            invalidateGitStatusCache(payload.path)
            invalidateGitStatusCache(projectPath)
            // The first pass removed live records; the history store's durable
            // cwd index lets this pass remove cold scrollback as well.
            yield* terminals.closeAllUnderPath(payload.path, true).pipe(
              Effect.catchAll((error) => {
                logger.warn('Deferred terminal history cleanup after worktree removal failed', {
                  projectPath,
                  worktreePath: payload.path,
                  error: String(error),
                })
                return Effect.void
              }),
            )
          }
          return result
        }),
      )
    }),
  )
}
