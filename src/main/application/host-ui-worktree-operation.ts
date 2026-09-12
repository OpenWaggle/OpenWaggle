import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { SessionId } from '@shared/types/brand'
import type { GitWorktreeMutationResult } from '@shared/types/git'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import { createLogger } from '../logger'
import { GitWorktreeService } from '../ports/git-worktree-service'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SessionWorkspaceResourceRepository } from '../ports/session-workspace-resource-repository'
import { TerminalService } from '../ports/terminal-service'
import { resolveSessionWorktreeBranch } from '../services/git/session-branch-resolution'
import { invalidateGitStatusCache } from '../services/git-status-cache'

export const worktreeCreatePayloadSchema = Schema.Struct({
  path: Schema.String,
  branch: Schema.String,
  baseRef: Schema.String,
  /** Main resolves the authoritative branch for Session-bound worktrees. */
  sessionId: Schema.optional(Schema.String),
})

export const worktreeRemovePayloadSchema = Schema.Struct({
  path: Schema.String.pipe(Schema.minLength(1), Schema.filter(path.isAbsolute)),
  force: Schema.optional(Schema.Boolean),
})

const projectPathSchema = Schema.String.pipe(Schema.minLength(1))
const logger = createLogger('host-ui-worktree-operation')

function removeWorktreeWithTerminals(
  projectPath: string,
  payload: { readonly path: string; readonly force?: boolean },
) {
  return Effect.gen(function* () {
    const terminals = yield* TerminalService
    const gitWorktrees = yield* GitWorktreeService
    return yield* terminals.runWithMutationFence(
      { kind: 'path', directoryPath: payload.path },
      Effect.gen(function* () {
        yield* terminals.closeAllUnderPath(payload.path, false)
        const result = yield* gitWorktrees.remove(projectPath, payload)
        if (result.ok || result.code === 'not-found') {
          yield* terminals.closeAllUnderPath(payload.path, true).pipe(
            Effect.catchAll((error) =>
              Effect.sync(() => {
                logger.warn('Deferred terminal history cleanup after worktree removal', {
                  path: payload.path,
                  error: error.message,
                })
              }),
            ),
          )
        }
        return result
      }),
    )
  })
}

async function filesystemIdentity(candidate: string) {
  try {
    const canonical = await realpath(path.resolve(candidate))
    const identity = await stat(canonical)
    return `${String(identity.dev)}:${String(identity.ino)}`
  } catch {
    return null
  }
}

async function filesystemPathExists(candidate: string) {
  try {
    await stat(candidate)
    return true
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

async function findRemovalCandidate(
  projectPath: string,
  workingPath: string,
  candidates: readonly {
    readonly id: string
    readonly projectPath: string
    readonly workingPath: string
  }[],
) {
  const lexical = candidates.find(
    (candidate) => candidate.projectPath === projectPath && candidate.workingPath === workingPath,
  )
  if (lexical) return lexical
  const [projectIdentity, workingIdentity] = await Promise.all([
    filesystemIdentity(projectPath),
    filesystemIdentity(workingPath),
  ])
  if (!projectIdentity || !workingIdentity) return undefined
  const matches = await Promise.all(
    candidates.map(async (candidate) => {
      const [candidateProject, candidateWorking] = await Promise.all([
        filesystemIdentity(candidate.projectPath),
        filesystemIdentity(candidate.workingPath),
      ])
      return candidateProject === projectIdentity && candidateWorking === workingIdentity
        ? candidate
        : undefined
    }),
  )
  return matches.find((candidate) => candidate !== undefined)
}

export function createHostUiWorktree(rawPath: unknown, rawPayload: unknown) {
  return Effect.gen(function* () {
    const projectPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
    const payload = decodeUnknownOrThrow(worktreeCreatePayloadSchema, rawPayload)
    const sessionId = payload.sessionId
    const gitWorktrees = yield* GitWorktreeService
    const workspaces = yield* SessionWorkspaceResourceRepository
    const workspace =
      sessionId === undefined ? null : yield* workspaces.getBound(SessionId(sessionId))
    if (sessionId !== undefined && workspace === null) {
      return {
        ok: false,
        code: 'unknown',
        message: 'This Session no longer has an authoritative Workspace binding.',
      } satisfies GitWorktreeMutationResult
    }
    if (workspace !== null && workspace.kind !== 'managed-worktree') {
      return {
        ok: false,
        code: 'unknown',
        message: 'This Session is not bound to a managed worktree Workspace.',
      } satisfies GitWorktreeMutationResult
    }
    if (workspace !== null && workspace.projectPath !== projectPath) {
      return {
        ok: false,
        code: 'unknown',
        message: 'This Session is bound to a Workspace in a different repository.',
      } satisfies GitWorktreeMutationResult
    }
    const path = workspace?.workingPath ?? payload.path
    const branch =
      workspace?.worktreeBranch ??
      (sessionId === undefined
        ? payload.branch
        : yield* Effect.promise(() => resolveSessionWorktreeBranch(projectPath, sessionId)))
    if (sessionId !== undefined) {
      const sessions = yield* SessionProjectionRepository
      yield* sessions.resetWorktreeSetup(SessionId(sessionId), path)
    }
    const result = (yield* gitWorktrees.create(projectPath, {
      ...payload,
      path,
      branch,
    })) satisfies GitWorktreeMutationResult
    if (result.ok) {
      invalidateGitStatusCache(path)
      invalidateGitStatusCache(projectPath)
    }
    return result
  })
}

export function removeHostUiWorktree(rawPath: unknown, rawPayload: unknown) {
  return Effect.gen(function* () {
    const projectPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
    const payload = decodeUnknownOrThrow(worktreeRemovePayloadSchema, rawPayload)
    const workspaces = yield* SessionWorkspaceResourceRepository
    const candidates = yield* workspaces.listManagedWorktreeRemovalCandidates()
    const candidate = yield* Effect.promise(() =>
      findRemovalCandidate(projectPath, payload.path, candidates),
    )
    const result = yield* Effect.uninterruptible(
      Effect.acquireUseRelease(
        workspaces.admitManagedWorktreeRemoval({
          ...(candidate ? { resourceId: candidate.id } : {}),
          reservationId: `worktree-removal:${randomUUID()}`,
          projectPath: path.resolve(projectPath),
          workingPath: path.resolve(payload.path),
        }),
        (admission) =>
          admission.status === 'unavailable'
            ? Effect.succeed({
                ok: false,
                code: 'workspace-bound',
                message:
                  'This managed worktree is bound to a Session or is changing Workspace state.',
              } satisfies GitWorktreeMutationResult)
            : removeWorktreeWithTerminals(projectPath, payload),
        (admission, exit) => {
          if (admission.status === 'unavailable') return Effect.void
          return workspaces
            .finalizeManagedWorktreeRemoval({
              resourceId: admission.resourceId,
              createdReservation: admission.createdReservation,
              removed: Exit.isSuccess(exit) && (exit.value.ok || exit.value.code === 'not-found'),
            })
            .pipe(Effect.orDie)
        },
      ),
    )
    if (result.ok) {
      invalidateGitStatusCache(payload.path)
      invalidateGitStatusCache(projectPath)
    }
    return result
  })
}

export function recoverPendingManagedWorktreeRemovals(
  pending: readonly {
    readonly resourceId: string
    readonly workingPath: string
    readonly createdReservation: boolean
  }[],
) {
  return Effect.gen(function* () {
    const workspaces = yield* SessionWorkspaceResourceRepository
    return yield* Effect.forEach(pending, (removal) =>
      Effect.gen(function* () {
        const removed = removal.createdReservation
          ? false
          : !(yield* Effect.tryPromise({
              try: () => filesystemPathExists(removal.workingPath),
              catch: (cause) =>
                new Error(`Failed to inspect pending worktree removal ${removal.resourceId}.`, {
                  cause,
                }),
            }))
        yield* workspaces.finalizeManagedWorktreeRemoval({
          resourceId: removal.resourceId,
          createdReservation: removal.createdReservation,
          removed,
        })
      }).pipe(
        Effect.either,
        Effect.map((outcome) => ({ resourceId: removal.resourceId, outcome })),
      ),
    )
  })
}
