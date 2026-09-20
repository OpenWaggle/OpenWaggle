import { decodeUnknownOrThrow } from '@shared/schema'
import {
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
import { drainPendingSessionOutputs } from '../application/session-output-retry-drain'
import { SessionResourceRepository } from '../ports/session-resource-repository'
import { typedHandle } from './typed-ipc'

function decodeRouteSelection(rawSelection: unknown) {
  if (rawSelection === undefined || rawSelection === null) return null
  return decodeUnknownOrThrow(sessionResourceRouteSelectionSchema, rawSelection)
}

export function registerSessionResourceCatalogHandlers() {
  typedHandle('sessions:resources:page', (_event, rawSessionId: unknown, rawInput: unknown) =>
    Effect.gen(function* () {
      const sessionId = SessionId(
        decodeUnknownOrThrow(sessionResourceSessionIdSchema, rawSessionId),
      )
      const input = decodeUnknownOrThrow(sessionResourceCatalogPageRequestSchema, rawInput)
      yield* drainPendingSessionOutputs(sessionId)
      const repository = yield* SessionResourceRepository
      return yield* repository.listPage(sessionId, input)
    }),
  )

  typedHandle(
    'sessions:resources:get',
    (
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
  )

  typedHandle(
    'sessions:resources:locate-image',
    (_event, rawSessionId: unknown, rawResourceId: unknown, rawSelection: unknown) =>
      Effect.gen(function* () {
        const sessionId = SessionId(
          decodeUnknownOrThrow(sessionResourceSessionIdSchema, rawSessionId),
        )
        const resourceId = decodeUnknownOrThrow(sessionResourceIdSchema, rawResourceId)
        const selection = decodeRouteSelection(rawSelection)
        const repository = yield* SessionResourceRepository
        return yield* repository.locateImage(sessionId, resourceId, selection)
      }),
  )

  typedHandle('sessions:resources:node-page', (_event, rawSessionId: unknown, rawInput: unknown) =>
    Effect.gen(function* () {
      const sessionId = SessionId(
        decodeUnknownOrThrow(sessionResourceSessionIdSchema, rawSessionId),
      )
      const input = decodeUnknownOrThrow(sessionResourceNodePageRequestSchema, rawInput)
      const repository = yield* SessionResourceRepository
      return yield* repository.listByNodeIdsPage(sessionId, input)
    }),
  )

  typedHandle(
    'sessions:resources:list-by-node-ids',
    (_event, rawSessionId: unknown, rawNodeIds: unknown, rawKind: unknown, rawLimit: unknown) =>
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
  )
}
