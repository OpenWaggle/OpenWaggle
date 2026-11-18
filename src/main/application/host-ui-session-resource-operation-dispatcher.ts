import { match } from '@diegogbrisa/ts-match'
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
import type { HostBackedGuiChannel } from '@shared/types/host-ui-protocol'
import * as Effect from 'effect/Effect'
import { SessionRepository } from '../ports/session-repository'
import { SessionResourceRepository } from '../ports/session-resource-repository'
import {
  listPendingSessionOutputs,
  removePendingSessionOutput,
} from './session-change-request-output-retry'
import { drainPendingSessionOutputs } from './session-output-retry-drain'
import { captureProjectedSessionResources } from './session-resource-backfill'
import { advanceSessionResourceBackfillPage } from './session-resource-backfill-page'
import {
  prepareSessionResourceContent,
  readSessionResourceContentBytes,
  readSessionResourceThumbnail,
} from './session-resource-content'
import { withSessionResourceLock } from './session-resource-lock'
import { recordSessionChangeRequest } from './session-resource-recording'

export type HostUiSessionResourceChannel = Extract<
  HostBackedGuiChannel,
  `sessions:resources:${string}`
>

const LEGACY_PAGE_SIZE = 100
const THIRD_ARGUMENT = 2
const FOURTH_ARGUMENT = 3

function sessionId(raw: unknown) {
  return SessionId(decodeUnknownOrThrow(sessionResourceSessionIdSchema, raw))
}

function resourceId(raw: unknown) {
  return decodeUnknownOrThrow(sessionResourceIdSchema, raw)
}

function routeSelection(raw: unknown) {
  if (raw === undefined || raw === null) return null
  return decodeUnknownOrThrow(sessionResourceRouteSelectionSchema, raw)
}

function list(args: readonly unknown[]) {
  return Effect.gen(function* () {
    const id = sessionId(args[0])
    yield* drainPendingSessionOutputs(id)
    const repository = yield* SessionResourceRepository
    const status = yield* advanceSessionResourceBackfillPage(id)
    const page = yield* repository.listPage(id, { view: 'all', limit: LEGACY_PAGE_SIZE })
    return { resources: [...page.resources], ...status }
  })
}

function page(args: readonly unknown[]) {
  return Effect.gen(function* () {
    const id = sessionId(args[0])
    const input = decodeUnknownOrThrow(sessionResourceCatalogPageRequestSchema, args[1])
    yield* drainPendingSessionOutputs(id)
    return yield* (yield* SessionResourceRepository).listPage(id, input)
  })
}

function get(args: readonly unknown[]) {
  return SessionResourceRepository.pipe(
    Effect.flatMap((repository) =>
      repository.findById(
        sessionId(args[0]),
        resourceId(args[1]),
        decodeUnknownOrThrow(sessionResourceCatalogViewSchema, args[THIRD_ARGUMENT]),
        routeSelection(args[FOURTH_ARGUMENT]),
      ),
    ),
  )
}

function locateImage(args: readonly unknown[]) {
  return SessionResourceRepository.pipe(
    Effect.flatMap((repository) =>
      repository.locateImage(
        sessionId(args[0]),
        resourceId(args[1]),
        routeSelection(args[THIRD_ARGUMENT]),
      ),
    ),
  )
}

function nodePage(args: readonly unknown[]) {
  return SessionResourceRepository.pipe(
    Effect.flatMap((repository) =>
      repository.listByNodeIdsPage(
        sessionId(args[0]),
        decodeUnknownOrThrow(sessionResourceNodePageRequestSchema, args[1]),
      ),
    ),
  )
}

function listByNodeIds(args: readonly unknown[]) {
  return Effect.gen(function* () {
    const resources = yield* (yield* SessionResourceRepository).listByNodeIds(
      sessionId(args[0]),
      decodeUnknownOrThrow(sessionResourceNodeIdsSchema, args[1]),
      decodeUnknownOrThrow(sessionResourceKindOrNullSchema, args[THIRD_ARGUMENT]),
      decodeUnknownOrThrow(sessionResourceTargetLimitSchema, args[FOURTH_ARGUMENT]),
    )
    return [...resources]
  })
}

function backfill(args: readonly unknown[]) {
  return Effect.gen(function* () {
    const id = sessionId(args[0])
    yield* drainPendingSessionOutputs(id)
    return yield* advanceSessionResourceBackfillPage(id)
  })
}

function hostContent(args: readonly unknown[]) {
  return Effect.gen(function* () {
    const id = sessionId(args[0])
    const targetId = resourceId(args[1])
    const resource = yield* (yield* SessionResourceRepository).findById(id, targetId, 'images')
    if (!resource?.available || resource.kind !== 'image') return null
    const content = yield* readSessionResourceContentBytes(id, targetId)
    if (!content?.mimeType.toLowerCase().startsWith('image/')) return null
    return {
      resourceId: content.resourceId,
      fileName: content.fileName,
      mimeType: content.mimeType,
      dataBase64: Buffer.from(content.bytes).toString('base64'),
    }
  })
}

function retry(args: readonly unknown[]) {
  return Effect.gen(function* () {
    const id = sessionId(args[0])
    const targetId = resourceId(args[1])
    const repository = yield* SessionResourceRepository
    const resource = yield* repository.findById(id, targetId, 'all')
    if (!resource) return
    if (
      !resource.available &&
      resource.kind === 'image' &&
      resource.locator?.startsWith('https://')
    ) {
      yield* prepareSessionResourceContent(id, targetId)
      return
    }
    if (resource.available && !resource.managed) return
    const nodeIds = new Set(resource.occurrences.flatMap(({ nodeId }) => (nodeId ? [nodeId] : [])))
    if (nodeIds.size === 0) return
    const nodes = yield* (yield* SessionRepository).getResourceProjectionNodes(id, [...nodeIds])
    yield* captureProjectedSessionResources({
      sessionId: id,
      nodes,
      retryUnavailableResourceId: targetId,
    })
  })
}

function recordChangeRequest(args: readonly unknown[]) {
  return Effect.gen(function* () {
    const id = sessionId(args[0])
    const input = decodeUnknownOrThrow(recordSessionChangeRequestInputSchema, args[1])
    return yield* withSessionResourceLock(
      id,
      Effect.gen(function* () {
        const pending = (yield* listPendingSessionOutputs(id)).find(
          (output) =>
            output.kind === 'change-request' &&
            output.title === input.title &&
            output.url === input.url,
        )
        if (!pending) {
          const existing = yield* (yield* SessionResourceRepository).findByLocator(
            id,
            'change-request',
            input.url,
          )
          if (existing) return existing
          return yield* Effect.fail(
            new Error('No matching created change request is pending Output recording.'),
          )
        }
        const recorded = yield* recordSessionChangeRequest(id, input, pending)
        yield* removePendingSessionOutput(pending)
        return recorded
      }),
    )
  })
}

export function isHostUiSessionResourceChannel(
  channel: HostBackedGuiChannel,
): channel is HostUiSessionResourceChannel {
  return channel.startsWith('sessions:resources:')
}

export function dispatchHostUiSessionResourceOperation(
  channel: HostUiSessionResourceChannel,
  args: readonly unknown[],
) {
  return match(channel)
    .with('sessions:resources:list', () => list(args))
    .with('sessions:resources:page', () => page(args))
    .with('sessions:resources:get', () => get(args))
    .with('sessions:resources:locate-image', () => locateImage(args))
    .with('sessions:resources:node-page', () => nodePage(args))
    .with('sessions:resources:list-by-node-ids', () => listByNodeIds(args))
    .with('sessions:resources:backfill', () => backfill(args))
    .with('sessions:resources:host-content', () => hostContent(args))
    .with('sessions:resources:thumbnail', () =>
      readSessionResourceThumbnail(sessionId(args[0]), resourceId(args[1])),
    )
    .with('sessions:resources:retry', () => retry(args))
    .with('sessions:resources:record-change-request', () => recordChangeRequest(args))
    .exhaustive()
}
