/** The Session resource operations the window ran before A-F5; see `legacy-host-operations`. */

import { decodeUnknownOrThrow } from '@shared/schema'
import {
  recordSessionChangeRequestInputSchema,
  sessionResourceCatalogPageRequestSchema,
  sessionResourceCatalogViewSchema,
  sessionResourceIdSchema,
  sessionResourceKindOrNullSchema,
  sessionResourceNodeIdsSchema,
  sessionResourceNodePageRequestSchema,
  sessionResourceRouteSelectionSchema,
  sessionResourceSessionIdSchema,
  sessionResourceTargetLimitSchema,
} from '@shared/schemas/session-resource'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import {
  listPendingSessionOutputs,
  removePendingSessionOutput,
} from '../../application/session-change-request-output-retry'
import { drainPendingSessionOutputs } from '../../application/session-output-retry-drain'
import { captureProjectedSessionResources } from '../../application/session-resource-backfill'
import { advanceSessionResourceBackfillPage } from '../../application/session-resource-backfill-page'
import { prepareSessionResourceContent } from '../../application/session-resource-content'
import { withSessionResourceLock } from '../../application/session-resource-lock'
import { recordSessionChangeRequest } from '../../application/session-resource-recording'
import { SessionRepository } from '../../ports/session-repository'
import { SessionResourceRepository } from '../../ports/session-resource-repository'
import type { LegacyHostOperationTable } from './legacy-host-operation-types'

const SESSION_RESOURCE_LEGACY_PAGE_SIZE = 100

function decodeRouteSelection(rawSelection: unknown) {
  if (rawSelection === undefined || rawSelection === null) return null
  return decodeUnknownOrThrow(sessionResourceRouteSelectionSchema, rawSelection)
}

export const legacySessionResourceOperations = {
  'sessions:resources:page': (_event, rawSessionId: unknown, rawInput: unknown) =>
    Effect.gen(function* () {
      const sessionId = SessionId(
        decodeUnknownOrThrow(sessionResourceSessionIdSchema, rawSessionId),
      )
      const input = decodeUnknownOrThrow(sessionResourceCatalogPageRequestSchema, rawInput)
      yield* drainPendingSessionOutputs(sessionId)
      const repository = yield* SessionResourceRepository
      return yield* repository.listPage(sessionId, input)
    }),
  'sessions:resources:get': (
    _event,
    rawSessionId: unknown,
    rawResourceId: unknown,
    rawView: unknown,
    rawSelection: unknown,
  ) =>
    Effect.gen(function* () {
      const sessionId = SessionId(
        decodeUnknownOrThrow(sessionResourceSessionIdSchema, rawSessionId),
      )
      const resourceId = decodeUnknownOrThrow(sessionResourceIdSchema, rawResourceId)
      const view = decodeUnknownOrThrow(sessionResourceCatalogViewSchema, rawView)
      const selection = decodeRouteSelection(rawSelection)
      const repository = yield* SessionResourceRepository
      return yield* repository.findById(sessionId, resourceId, view, selection)
    }),
  'sessions:resources:locate-image': (
    _event,
    rawSessionId: unknown,
    rawResourceId: unknown,
    rawSelection: unknown,
  ) =>
    Effect.gen(function* () {
      const sessionId = SessionId(
        decodeUnknownOrThrow(sessionResourceSessionIdSchema, rawSessionId),
      )
      const resourceId = decodeUnknownOrThrow(sessionResourceIdSchema, rawResourceId)
      const selection = decodeRouteSelection(rawSelection)
      const repository = yield* SessionResourceRepository
      return yield* repository.locateImage(sessionId, resourceId, selection)
    }),
  'sessions:resources:node-page': (_event, rawSessionId: unknown, rawInput: unknown) =>
    Effect.gen(function* () {
      const sessionId = SessionId(
        decodeUnknownOrThrow(sessionResourceSessionIdSchema, rawSessionId),
      )
      const input = decodeUnknownOrThrow(sessionResourceNodePageRequestSchema, rawInput)
      const repository = yield* SessionResourceRepository
      return yield* repository.listByNodeIdsPage(sessionId, input)
    }),
  'sessions:resources:list-by-node-ids': (
    _event,
    rawSessionId: unknown,
    rawNodeIds: unknown,
    rawKind: unknown,
    rawLimit: unknown,
  ) =>
    Effect.gen(function* () {
      const sessionId = SessionId(
        decodeUnknownOrThrow(sessionResourceSessionIdSchema, rawSessionId),
      )
      const nodeIds = decodeUnknownOrThrow(sessionResourceNodeIdsSchema, rawNodeIds)
      const kind = decodeUnknownOrThrow(sessionResourceKindOrNullSchema, rawKind)
      const limit = decodeUnknownOrThrow(sessionResourceTargetLimitSchema, rawLimit)
      const repository = yield* SessionResourceRepository
      return [...(yield* repository.listByNodeIds(sessionId, nodeIds, kind, limit))]
    }),
  'sessions:resources:list': (_event, rawSessionId: unknown) =>
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
  'sessions:resources:backfill': (_event, rawSessionId: unknown) =>
    Effect.gen(function* () {
      const sessionId = SessionId(
        decodeUnknownOrThrow(sessionResourceSessionIdSchema, rawSessionId),
      )
      yield* drainPendingSessionOutputs(sessionId)
      return yield* advanceSessionResourceBackfillPage(sessionId)
    }),
  'sessions:resources:retry': (_event, rawSessionId: unknown, rawResourceId: unknown) =>
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
  'sessions:resources:record-change-request': (_event, rawSessionId: unknown, rawInput) =>
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
            const existing = yield* repository.findByLocator(sessionId, 'change-request', input.url)
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
} satisfies LegacyHostOperationTable
