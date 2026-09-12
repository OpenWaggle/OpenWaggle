import fs from 'node:fs/promises'
import type { SessionId } from '@shared/types/brand'
import { resolveSessionWorkingDir } from '@shared/utils/worktree'
import * as Effect from 'effect/Effect'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { resolveRepositoryRoot } from './working-tree-service'

/** Verify that a Git mutation targets the working tree owned by its originating Session. */
export function verifySessionWorkingPath(sessionId: SessionId, requestedWorkingPath: string) {
  return Effect.gen(function* () {
    const sessions = yield* SessionProjectionRepository
    const session = yield* sessions.getOptional(sessionId)
    if (!session) return false
    const expectedWorkingPath = resolveSessionWorkingDir(session, session.projectPath)
    if (!expectedWorkingPath) return false
    const [requestedRoot, expectedRoot] = yield* Effect.promise(() =>
      Promise.all([
        resolveRepositoryRoot(requestedWorkingPath).then((root) => root ?? requestedWorkingPath),
        resolveRepositoryRoot(expectedWorkingPath).then((root) => root ?? expectedWorkingPath),
      ]),
    )
    const [realRequestedRoot, realExpectedRoot] = yield* Effect.promise(() =>
      Promise.all([fs.realpath(requestedRoot), fs.realpath(expectedRoot)]),
    )
    return realRequestedRoot === realExpectedRoot
  }).pipe(Effect.catchAll(() => Effect.succeed(false)))
}
