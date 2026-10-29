import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import type { GitWorktreeMutationResult, GitWorktreeRemovePayload } from '@shared/types/git'
import { isEnoent } from '@shared/utils/node-error'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import { ActionRunService } from '../ports/action-run-service'
import { SessionWorkspaceResourceRepository } from '../ports/session-workspace-resource-repository'
import { invalidateGitStatusCache } from '../services/git-status-cache'
import { prepareWorkspaceRemoval } from './workspace-cleanup'

async function checkoutMissing(directory: string) {
  try {
    await stat(directory)
    return false
  } catch (error) {
    if (isEnoent(error)) return true
    throw error
  }
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

/**
 * The Workspace resource of the folder being removed. A resource records its Session's project
 * path, which may be a subfolder or a linked worktree of the repository, while removal runs from
 * the main checkout, so the folder alone identifies it. When several records name the folder,
 * the one of this project wins.
 */
async function findRemovalCandidate(
  projectPath: string,
  workingPath: string,
  candidates: readonly {
    readonly id: string
    readonly projectPath: string
    readonly workingPath: string
  }[],
) {
  const resolvedWorking = path.resolve(workingPath)
  const workingIdentity = await filesystemIdentity(resolvedWorking)
  const sameFolder = (
    await Promise.all(
      candidates.map(async (candidate) =>
        candidate.workingPath === resolvedWorking ||
        (workingIdentity !== null &&
          (await filesystemIdentity(candidate.workingPath)) === workingIdentity)
          ? candidate
          : undefined,
      ),
    )
  ).filter((candidate) => candidate !== undefined)
  if (sameFolder.length <= 1) return sameFolder[0]
  const projectIdentity = await filesystemIdentity(projectPath)
  for (const candidate of sameFolder) {
    if (candidate.projectPath === path.resolve(projectPath)) return candidate
    if (
      projectIdentity !== null &&
      (await filesystemIdentity(candidate.projectPath)) === projectIdentity
    ) {
      return candidate
    }
  }
  return sameFolder[0]
}

function unavailableRemoval(options: { readonly admitArchivedBindings?: boolean }) {
  return {
    ok: false,
    code: 'workspace-bound',
    message: options.admitArchivedBindings
      ? 'A Session that is not archived, or has a Run, works in this worktree, or its Workspace is changing.'
      : 'This managed worktree is bound to a Session or is changing Workspace state.',
  } satisfies GitWorktreeMutationResult
}

export function removePreparedWorktree<E, R>(
  projectPath: string,
  payload: GitWorktreeRemovePayload,
  remove: Effect.Effect<GitWorktreeMutationResult, E, R>,
  options: {
    readonly retryFailed: boolean
    readonly actionFenceHeld?: boolean
    readonly validateRemoval?: Effect.Effect<GitWorktreeMutationResult>
    /** Settings removal: archived, idle Sessions keep their binding (ADR 0060). */
    readonly admitArchivedBindings?: boolean
  },
) {
  return Effect.gen(function* () {
    const workspaces = yield* SessionWorkspaceResourceRepository
    const actions = yield* ActionRunService
    const candidates = yield* workspaces.listManagedWorktreeRemovalCandidates()
    const candidate = yield* Effect.promise(() =>
      findRemovalCandidate(projectPath, payload.path, candidates),
    )
    const workspaceId = candidate?.id ?? `worktree-removal:${randomUUID()}`
    const operation = Effect.uninterruptible(
      Effect.acquireUseRelease(
        workspaces.admitManagedWorktreeRemoval({
          ...(candidate ? { resourceId: candidate.id } : {}),
          reservationId: workspaceId,
          projectPath: path.resolve(projectPath),
          workingPath: path.resolve(payload.path),
          ...(options.admitArchivedBindings ? { admitArchivedBindings: true } : {}),
        }),
        (admission) =>
          Effect.gen(function* () {
            if (admission.status === 'unavailable') return unavailableRemoval(options)
            const missing = yield* Effect.tryPromise({
              try: () => checkoutMissing(payload.path),
              catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
            })
            if (!missing && options.validateRemoval) {
              const validation = yield* options.validateRemoval
              if (!validation.ok) return validation
            }
            const blocked = missing
              ? yield* actions.stopWorkspaceRuns(admission.resourceId).pipe(Effect.as(null))
              : yield* prepareWorkspaceRemoval(
                  {
                    workspaceId: admission.resourceId,
                    projectPath: candidate?.projectPath ?? path.resolve(projectPath),
                    workspacePath: candidate?.workingPath ?? path.resolve(payload.path),
                  },
                  { ...options, ...(payload.skipCleanup ? { skipCleanup: true } : {}) },
                )
            if (blocked) return blocked
            // Cleanup can create files or lock the checkout after the first preflight.
            if (!missing && options.validateRemoval) {
              const validation = yield* options.validateRemoval
              if (!validation.ok) return validation
            }
            return yield* remove
          }),
        (admission, exit) =>
          admission.status === 'unavailable'
            ? Effect.void
            : workspaces
                .finalizeManagedWorktreeRemoval({
                  resourceId: admission.resourceId,
                  createdReservation: admission.createdReservation,
                  removed:
                    Exit.isSuccess(exit) && (exit.value.ok || exit.value.code === 'not-found'),
                })
                .pipe(Effect.zipRight(actions.cleanupDeletedWorkspaces), Effect.orDie),
      ),
    )
    const result = yield* options.actionFenceHeld
      ? operation
      : actions.withWorkspaceMutation(workspaceId, operation)
    if (result.ok) {
      invalidateGitStatusCache(payload.path)
      invalidateGitStatusCache(projectPath)
    }
    return result
  })
}
