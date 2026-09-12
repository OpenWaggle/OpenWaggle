import { decodeUnknownOrThrow } from '@shared/schema'
import {
  recordSessionChangeRequestInputSchema,
  sessionResourceIdSchema,
  sessionResourceSessionIdSchema,
} from '@shared/schemas/session-resource'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import {
  listPendingSessionOutputs,
  removePendingSessionOutput,
} from '../application/session-change-request-output-retry'
import { drainPendingSessionOutputs } from '../application/session-output-retry-drain'
import { captureProjectedSessionResources } from '../application/session-resource-backfill'
import { prepareSessionResourceContent } from '../application/session-resource-content'
import { withSessionResourceLock } from '../application/session-resource-lock'
import { recordSessionChangeRequest } from '../application/session-resource-recording'
import { SessionRepository, type SessionRepositoryShape } from '../ports/session-repository'
import {
  SessionResourceRepository,
  type SessionResourceRepositoryShape,
} from '../ports/session-resource-repository'
import { registerSessionResourceCatalogHandlers } from './session-resource-catalog-handlers'
import { registerSessionResourceImageHandlers } from './session-resource-image-handlers'
import { typedHandle } from './typed-ipc'

export const SESSION_RESOURCE_BACKFILL_PAGE_SIZE = 64
const SESSION_RESOURCE_RECHECK_NODE_LIMIT = 64
const SESSION_RESOURCE_LEGACY_PAGE_SIZE = 100

function recheckCompletedManagedResources(
  sessionId: SessionId,
  repository: SessionResourceRepositoryShape,
  sessions: SessionRepositoryShape,
) {
  return Effect.gen(function* () {
    const nodeIds = new Set(
      yield* repository.listManagedNodeIds(sessionId, SESSION_RESOURCE_RECHECK_NODE_LIMIT),
    )
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
      return { backfillComplete: true, progressed: false }
    }
    let backfillComplete = false
    let progressed = false
    const result = yield* captureProjectedSessionResources({
      sessionId,
      nodes: page.nodes,
    }).pipe(Effect.option)
    if (result._tag === 'Some') {
      progressed = result.value.progressed
      if (result.value.fullyProjected) {
        yield* repository.advanceBackfillCursor(sessionId, page.throughCreatedOrder)
        backfillComplete = !page.hasMore
        progressed = true
      }
    }
    return { backfillComplete, progressed }
  })
}

export function registerSessionResourceHandlers(): void {
  registerSessionResourceCatalogHandlers()
  registerSessionResourceImageHandlers()
  typedHandle('sessions:resources:list', (_event, rawSessionId: unknown) =>
    Effect.gen(function* () {
      const sessionId = SessionId(
        decodeUnknownOrThrow(sessionResourceSessionIdSchema, rawSessionId),
      )
      yield* drainPendingSessionOutputs(sessionId)
      const repository = yield* SessionResourceRepository
      const status = yield* advanceSessionResourceBackfillPage(sessionId)
      const page = yield* repository.listPage(sessionId, {
        view: 'all',
        limit: SESSION_RESOURCE_LEGACY_PAGE_SIZE,
      })
      return { resources: [...page.resources], ...status }
    }),
  )

  typedHandle('sessions:resources:backfill', (_event, rawSessionId: unknown) =>
    Effect.gen(function* () {
      const sessionId = SessionId(
        decodeUnknownOrThrow(sessionResourceSessionIdSchema, rawSessionId),
      )
      yield* drainPendingSessionOutputs(sessionId)
      return yield* advanceSessionResourceBackfillPage(sessionId)
    }),
  )

  typedHandle('sessions:resources:retry', (_event, rawSessionId: unknown, rawResourceId: unknown) =>
    Effect.gen(function* () {
      const sessionId = SessionId(
        decodeUnknownOrThrow(sessionResourceSessionIdSchema, rawSessionId),
      )
      const resourceId = decodeUnknownOrThrow(sessionResourceIdSchema, rawResourceId)
      const repository = yield* SessionResourceRepository
      const resource = yield* repository.findById(sessionId, resourceId, 'all')
      if (!resource) return undefined
      if (
        !resource.available &&
        resource.kind === 'image' &&
        resource.locator?.startsWith('https://')
      ) {
        yield* prepareSessionResourceContent(sessionId, resourceId)
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
        return yield* withSessionResourceLock(
          sessionId,
          Effect.gen(function* () {
            const pending = (yield* listPendingSessionOutputs(sessionId)).find(
              (output) =>
                output.kind === 'change-request' &&
                output.title === input.title &&
                output.url === input.url,
            )
            if (!pending) {
              const repository = yield* SessionResourceRepository
              const existing = yield* repository.findByLocator(
                sessionId,
                'change-request',
                input.url,
              )
              if (existing) return existing
              return yield* Effect.fail(
                new Error('No matching created change request is pending Output recording.'),
              )
            }
            const recorded = yield* recordSessionChangeRequest(sessionId, input, pending)
            yield* removePendingSessionOutput(pending)
            return recorded
          }),
        )
      }),
  )
}
