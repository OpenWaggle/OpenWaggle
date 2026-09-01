import type { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { type Mock, vi } from 'vitest'
import { clearPendingChangeRequestOutputsForTests } from '../../application/session-change-request-output-retry'
import { SessionResourceRepositoryError } from '../../errors'
import { SessionRepository, type SessionRepositoryShape } from '../../ports/session-repository'
import {
  SessionResourceImageFetcher,
  type SessionResourceImageFetcherShape,
} from '../../ports/session-resource-image-fetcher'
import {
  SessionResourceRepository,
  type SessionResourceRepositoryShape,
  type UpsertSessionResourceInput,
} from '../../ports/session-resource-repository'
import {
  SessionResourceStore,
  type SessionResourceStoreShape,
} from '../../ports/session-resource-store'
import {
  SessionResourceThumbnailer,
  type SessionResourceThumbnailerShape,
} from '../../ports/session-resource-thumbnailer'
import {
  registerSessionResourceHandlers,
  SESSION_RESOURCE_BACKFILL_PAGE_SIZE,
} from '../session-resource-handler'

export function sessionResourceBackfillPageSize() {
  return SESSION_RESOURCE_BACKFILL_PAGE_SIZE
}

interface HandlerMocks {
  readonly typedHandle: Mock
  readonly list: Mock
  readonly getContentLocation: Mock
  readonly read: Mock
  readonly thumbnail: Mock
  readonly listResourceProjectionPage: Mock
  readonly getResourceProjectionNodes: Mock
  readonly getBackfillCursor: Mock
  readonly advanceBackfillCursor: Mock
  readonly upsert: Mock
}

const handlerMocks: HandlerMocks = vi.hoisted(() => ({
  typedHandle: vi.fn(),
  list: vi.fn(),
  getContentLocation: vi.fn(),
  read: vi.fn(),
  thumbnail: vi.fn(),
  listResourceProjectionPage: vi.fn(),
  getResourceProjectionNodes: vi.fn(),
  getBackfillCursor: vi.fn(),
  advanceBackfillCursor: vi.fn(),
  upsert: vi.fn(),
}))

export function getSessionResourceHandlerMocks() {
  return handlerMocks
}

vi.mock('../typed-ipc', () => ({ typedHandle: handlerMocks.typedHandle }))

const TestLayer = Layer.mergeAll(
  Layer.succeed(
    SessionRepository,
    SessionRepository.of(
      fromPartial<SessionRepositoryShape>({
        getWorkspace: () => Effect.succeed(null),
        listResourceProjectionPage: (sessionId: SessionId, cursor: number, limit: number) =>
          Effect.sync(() => handlerMocks.listResourceProjectionPage(sessionId, cursor, limit)),
        getResourceProjectionNodes: (sessionId: SessionId, nodeIds: readonly string[]) =>
          Effect.sync(() => handlerMocks.getResourceProjectionNodes(sessionId, nodeIds)),
      }),
    ),
  ),
  Layer.succeed(
    SessionResourceRepository,
    SessionResourceRepository.of(
      fromPartial<SessionResourceRepositoryShape>({
        list: (sessionId: SessionId) =>
          Effect.try({
            try: () => handlerMocks.list(sessionId),
            catch: (cause) => new SessionResourceRepositoryError({ operation: 'list', cause }),
          }),
        getContentLocation: (sessionId: SessionId, resourceId: string) =>
          Effect.sync(() => handlerMocks.getContentLocation(sessionId, resourceId)),
        getBackfillCursor: (sessionId: SessionId) =>
          Effect.sync(() => handlerMocks.getBackfillCursor(sessionId)),
        advanceBackfillCursor: (sessionId: SessionId, throughCreatedOrder: number) =>
          Effect.sync(() => handlerMocks.advanceBackfillCursor(sessionId, throughCreatedOrder)),
        upsert: (input: UpsertSessionResourceInput) =>
          Effect.sync(() => handlerMocks.upsert(input)).pipe(
            Effect.as({
              ...input,
              occurrences: [input.occurrence],
              isSource:
                input.occurrence.activity === 'provided' || input.occurrence.activity === 'read',
              isOutput:
                input.occurrence.activity === 'created' || input.occurrence.activity === 'updated',
            }),
          ),
        hasOccurrence: () => Effect.succeed(false),
        findByCanonicalKey: () => Effect.succeed(null),
      }),
    ),
  ),
  Layer.succeed(
    SessionResourceStore,
    SessionResourceStore.of(
      fromPartial<SessionResourceStoreShape>({
        read: (managedPath: string) => Effect.sync(() => handlerMocks.read(managedPath)),
      }),
    ),
  ),
  Layer.succeed(
    SessionResourceImageFetcher,
    SessionResourceImageFetcher.of(fromPartial<SessionResourceImageFetcherShape>({})),
  ),
  Layer.succeed(
    SessionResourceThumbnailer,
    SessionResourceThumbnailer.of(
      fromPartial<SessionResourceThumbnailerShape>({
        create: (bytes: Uint8Array, mimeType: string) =>
          Effect.sync(() => handlerMocks.thumbnail(bytes, mimeType)),
      }),
    ),
  ),
)

export function invokeSessionResourceHandler(channel: string, ...args: readonly unknown[]) {
  const handler = handlerMocks.typedHandle.mock.calls.find((call) => call[0] === channel)?.[1]
  if (typeof handler !== 'function') throw new Error(`Missing handler for ${channel}`)
  return Effect.runPromise(Effect.provide(handler({}, ...args), TestLayer))
}

export function resetSessionResourceHandlerHarness() {
  clearPendingChangeRequestOutputsForTests()
  handlerMocks.typedHandle.mockClear()
  handlerMocks.list.mockReset().mockReturnValue([])
  handlerMocks.getContentLocation.mockReset().mockReturnValue(null)
  handlerMocks.read.mockReset().mockReturnValue(Buffer.from('full-image'))
  handlerMocks.thumbnail
    .mockReset()
    .mockReturnValue({ bytes: Buffer.from('thumbnail'), mimeType: 'image/webp' })
  handlerMocks.listResourceProjectionPage
    .mockReset()
    .mockReturnValue({ nodes: [], throughCreatedOrder: null, hasMore: false })
  handlerMocks.getResourceProjectionNodes.mockReset().mockReturnValue([])
  handlerMocks.getBackfillCursor.mockReset().mockReturnValue(-1)
  handlerMocks.advanceBackfillCursor.mockReset()
  handlerMocks.upsert.mockReset()
  registerSessionResourceHandlers()
}
