import { decodeUnknownOrThrow } from '@shared/schema'
import {
  recordSessionChangeRequestInputSchema,
  sessionResourceIdSchema,
  sessionResourceSessionIdSchema,
} from '@shared/schemas/session-resource'
import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import {
  clearPendingChangeRequestOutput,
  clearPendingCommitOutput,
  isPendingChangeRequestOutput,
  listPendingCommitOutputs,
} from '../application/session-change-request-output-retry'
import { captureProjectedSessionResources } from '../application/session-resource-backfill'
import {
  readSessionResourceContent,
  readSessionResourceThumbnail,
} from '../application/session-resource-content'
import {
  recordSessionChangeRequest,
  recordSessionCommit,
} from '../application/session-resource-recording'
import { SessionRepository, type SessionRepositoryShape } from '../ports/session-repository'
import {
  SessionResourceRepository,
  type SessionResourceRepositoryShape,
} from '../ports/session-resource-repository'
import { typedHandle } from './typed-ipc'

export const SESSION_RESOURCE_BACKFILL_PAGE_SIZE = 64

function retryPendingCommitOutputs(sessionId: SessionId) {
  return Effect.forEach(listPendingCommitOutputs(sessionId), (commit) =>
    recordSessionCommit(sessionId, commit).pipe(
      Effect.tap(() => Effect.sync(() => clearPendingCommitOutput(sessionId, commit.commitHash))),
      Effect.catchAll(() => Effect.void),
    ),
  ).pipe(Effect.asVoid)
}

function managedResourceNodeIds(resources: readonly SessionResource[]) {
  const nodeIds = new Set<string>()
  for (const resource of resources) {
    if (!resource.available || !resource.managed) continue
    for (const occurrence of resource.occurrences) {
      if (occurrence.nodeId) nodeIds.add(occurrence.nodeId)
    }
  }
  return nodeIds
}

function recheckCompletedManagedResources(
  sessionId: SessionId,
  repository: SessionResourceRepositoryShape,
  sessions: SessionRepositoryShape,
) {
  return Effect.gen(function* () {
    const nodeIds = managedResourceNodeIds(yield* repository.list(sessionId))
    if (nodeIds.size === 0) return
    const nodes = yield* sessions.getResourceProjectionNodes(sessionId, [...nodeIds])
    if (nodes.length === 0) return
    yield* captureProjectedSessionResources({ sessionId, nodes }).pipe(
      Effect.catchAll(() => Effect.void),
    )
  })
}

function advanceSessionResourceBackfillPage(sessionId: SessionId) {
  return Effect.gen(function* () {
    const repository = yield* SessionResourceRepository
    const sessions = yield* SessionRepository
    const cursor = yield* repository.getBackfillCursor(sessionId)
    const page = yield* sessions.listResourceProjectionPage(
      sessionId,
      cursor,
      SESSION_RESOURCE_BACKFILL_PAGE_SIZE,
    )
    if (page.throughCreatedOrder === null) {
      yield* recheckCompletedManagedResources(sessionId, repository, sessions)
      return { backfillComplete: true }
    }
    let backfillComplete = false
    const result = yield* captureProjectedSessionResources({
      sessionId,
      nodes: page.nodes,
    }).pipe(Effect.option)
    if (result._tag === 'Some') {
      if (result.value.fullyProjected) {
        yield* repository.advanceBackfillCursor(sessionId, page.throughCreatedOrder)
        backfillComplete = !page.hasMore
      }
    }
    return { backfillComplete }
  })
}

export function registerSessionResourceHandlers(): void {
  typedHandle('sessions:resources:list', (_event, rawSessionId: unknown) =>
    Effect.gen(function* () {
      const sessionId = SessionId(
        decodeUnknownOrThrow(sessionResourceSessionIdSchema, rawSessionId),
      )
      yield* retryPendingCommitOutputs(sessionId)
      const repository = yield* SessionResourceRepository
      const status = yield* advanceSessionResourceBackfillPage(sessionId)
      return { resources: [...(yield* repository.list(sessionId))], ...status }
    }),
  )

  typedHandle('sessions:resources:backfill', (_event, rawSessionId: unknown) =>
    advanceSessionResourceBackfillPage(
      SessionId(decodeUnknownOrThrow(sessionResourceSessionIdSchema, rawSessionId)),
    ),
  )

  typedHandle('sessions:resources:read', (_event, rawSessionId: unknown, rawResourceId: unknown) =>
    Effect.gen(function* () {
      const sessionId = SessionId(
        decodeUnknownOrThrow(sessionResourceSessionIdSchema, rawSessionId),
      )
      const resourceId = decodeUnknownOrThrow(sessionResourceIdSchema, rawResourceId)
      return yield* readSessionResourceContent(sessionId, resourceId)
    }),
  )

  typedHandle(
    'sessions:resources:thumbnail',
    (_event, rawSessionId: unknown, rawResourceId: unknown) =>
      Effect.gen(function* () {
        const sessionId = SessionId(
          decodeUnknownOrThrow(sessionResourceSessionIdSchema, rawSessionId),
        )
        const resourceId = decodeUnknownOrThrow(sessionResourceIdSchema, rawResourceId)
        return yield* readSessionResourceThumbnail(sessionId, resourceId)
      }),
  )

  typedHandle('sessions:resources:retry', (_event, rawSessionId: unknown, rawResourceId: unknown) =>
    Effect.gen(function* () {
      const sessionId = SessionId(
        decodeUnknownOrThrow(sessionResourceSessionIdSchema, rawSessionId),
      )
      const resourceId = decodeUnknownOrThrow(sessionResourceIdSchema, rawResourceId)
      const repository = yield* SessionResourceRepository
      const resource = (yield* repository.list(sessionId)).find(({ id }) => id === resourceId)
      if (!resource) return undefined
      if (
        !resource.available &&
        resource.kind === 'image' &&
        resource.locator?.startsWith('https://')
      ) {
        yield* readSessionResourceContent(sessionId, resourceId)
        return undefined
      }
      if (resource.available && !resource.managed) return undefined
      const nodeIds = new Set(
        resource.occurrences.flatMap(({ nodeId }) => (nodeId ? [nodeId] : [])),
      )
      if (nodeIds.size === 0) return undefined
      const sessions = yield* SessionRepository
      const nodes = yield* sessions.getResourceProjectionNodes(sessionId, [...nodeIds])
      yield* captureProjectedSessionResources({
        sessionId,
        nodes,
        retryUnavailableResourceId: resourceId,
      })
      return undefined
    }),
  )

  typedHandle(
    'sessions:resources:record-change-request',
    (_event, rawSessionId: unknown, rawInput) =>
      Effect.gen(function* () {
        const sessionId = SessionId(
          decodeUnknownOrThrow(sessionResourceSessionIdSchema, rawSessionId),
        )
        const input = decodeUnknownOrThrow(recordSessionChangeRequestInputSchema, rawInput)
        if (!isPendingChangeRequestOutput(sessionId, input)) {
          return yield* Effect.fail(
            new Error('No matching created change request is pending Output recording.'),
          )
        }
        const recorded = yield* recordSessionChangeRequest(sessionId, input)
        clearPendingChangeRequestOutput(sessionId, input)
        return recorded
      }),
  )
}
