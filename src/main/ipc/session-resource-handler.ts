import { decodeUnknownOrThrow } from '@shared/schema'
import {
  recordSessionChangeRequestInputSchema,
  sessionResourceIdSchema,
  sessionResourceSessionIdSchema,
} from '@shared/schemas/session-resource'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { captureProjectedSessionResources } from '../application/session-resource-backfill'
import {
  readSessionResourceContent,
  readSessionResourceThumbnail,
} from '../application/session-resource-content'
import { recordSessionChangeRequest } from '../application/session-resource-recording'
import { SessionRepository } from '../ports/session-repository'
import { SessionResourceRepository } from '../ports/session-resource-repository'
import { typedHandle } from './typed-ipc'

export const SESSION_RESOURCE_BACKFILL_PAGE_SIZE = 64

export function registerSessionResourceHandlers(): void {
  typedHandle('sessions:resources:list', (_event, rawSessionId: unknown) =>
    Effect.gen(function* () {
      const sessionId = SessionId(
        decodeUnknownOrThrow(sessionResourceSessionIdSchema, rawSessionId),
      )
      const repository = yield* SessionResourceRepository
      const sessions = yield* SessionRepository
      const cursor = yield* repository.getBackfillCursor(sessionId)
      const page = yield* sessions.listResourceProjectionPage(
        sessionId,
        cursor,
        SESSION_RESOURCE_BACKFILL_PAGE_SIZE,
      )
      let backfillComplete = true
      if (page.throughCreatedOrder !== null) {
        const result = yield* captureProjectedSessionResources({
          sessionId,
          nodes: page.nodes,
        }).pipe(Effect.option)
        if (result._tag === 'Some') {
          if (result.value.fullyProjected) {
            yield* repository.advanceBackfillCursor(sessionId, page.throughCreatedOrder)
            backfillComplete = !page.hasMore
          } else {
            backfillComplete = false
          }
        } else {
          backfillComplete = false
        }
      }
      return { resources: [...(yield* repository.list(sessionId))], backfillComplete }
    }),
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
      if (!resource || resource.available) return undefined
      const nodeIds = new Set(
        resource.occurrences.flatMap(({ nodeId }) => (nodeId ? [nodeId] : [])),
      )
      if (nodeIds.size === 0) return undefined
      const sessions = yield* SessionRepository
      const tree = yield* sessions.getTree(sessionId)
      if (!tree) return undefined
      const nodes = tree.nodes.filter(({ id }) => nodeIds.has(String(id)))
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
      recordSessionChangeRequest(
        SessionId(decodeUnknownOrThrow(sessionResourceSessionIdSchema, rawSessionId)),
        decodeUnknownOrThrow(recordSessionChangeRequestInputSchema, rawInput),
      ),
  )
}
