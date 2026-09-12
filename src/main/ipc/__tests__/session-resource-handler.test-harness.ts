import { EventEmitter } from 'node:events'
import type { SessionId } from '@shared/types/brand'
import type {
  SessionResourceCatalogPageRequest,
  SessionResourceCatalogView,
  SessionResourceKind,
  SessionResourceNodePageRequest,
  SessionResourceRouteSelection,
} from '@shared/types/session-resource'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'
import { type Mock, vi } from 'vitest'
import { SessionResourceRepositoryError } from '../../errors'
import {
  type PendingSessionOutput,
  SessionOutputRetryRepository,
} from '../../ports/session-output-retry-repository'
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
  readonly typedOn: Mock
  readonly list: Mock
  readonly listPage: Mock
  readonly findById: Mock
  readonly locateImage: Mock
  readonly listByNodeIdsPage: Mock
  readonly getContentLocation: Mock
  readonly inspect: Mock
  readonly read: Mock
  readonly thumbnail: Mock
  readonly listResourceProjectionPage: Mock
  readonly getResourceProjectionNodes: Mock
  readonly getBackfillCursor: Mock
  readonly advanceBackfillCursor: Mock
  readonly upsert: Mock
  readonly pendingOutputs: PendingSessionOutput[]
}

const handlerMocks: HandlerMocks = vi.hoisted(() => ({
  typedHandle: vi.fn(),
  typedOn: vi.fn(),
  list: vi.fn(),
  listPage: vi.fn(),
  findById: vi.fn(),
  locateImage: vi.fn(),
  listByNodeIdsPage: vi.fn(),
  getContentLocation: vi.fn(),
  inspect: vi.fn(),
  read: vi.fn(),
  thumbnail: vi.fn(),
  listResourceProjectionPage: vi.fn(),
  getResourceProjectionNodes: vi.fn(),
  getBackfillCursor: vi.fn(),
  advanceBackfillCursor: vi.fn(),
  upsert: vi.fn(),
  pendingOutputs: [],
}))

let handlerSenderId = 7_100
let handlerSender = Object.assign(new EventEmitter(), { id: handlerSenderId })

export function getSessionResourceHandlerMocks() {
  return handlerMocks
}

vi.mock('../typed-ipc', () => ({
  typedHandle: handlerMocks.typedHandle,
  typedOn: handlerMocks.typedOn,
}))

const TestLayer = Layer.mergeAll(
  Layer.succeed(
    SessionOutputRetryRepository,
    SessionOutputRetryRepository.of({
      put: (output) =>
        Effect.sync(() => {
          const index = handlerMocks.pendingOutputs.findIndex(({ id }) => id === output.id)
          if (index === -1) {
            handlerMocks.pendingOutputs.push(output)
            return output
          }
          return handlerMocks.pendingOutputs[index] ?? output
        }),
      list: (sessionId) =>
        Effect.succeed(
          handlerMocks.pendingOutputs.filter((output) => output.sessionId === sessionId),
        ),
      remove: (output) =>
        Effect.sync(() => {
          const index = handlerMocks.pendingOutputs.findIndex(
            (candidate) => candidate.sessionId === output.sessionId && candidate.id === output.id,
          )
          if (index !== -1) handlerMocks.pendingOutputs.splice(index, 1)
        }),
    }),
  ),
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
        listPage: (sessionId: SessionId, input: SessionResourceCatalogPageRequest) =>
          Effect.try({
            try: () => {
              if (handlerMocks.listPage.getMockImplementation()) {
                return handlerMocks.listPage(sessionId, input)
              }
              const resources = handlerMocks.list(sessionId)
              return {
                resources: resources.slice(0, input.limit),
                total: resources.length,
                nextCursor: null,
                orderRevision: 'none',
              }
            },
            catch: (cause) => new SessionResourceRepositoryError({ operation: 'listPage', cause }),
          }),
        findById: (
          sessionId: SessionId,
          resourceId: string,
          view: SessionResourceCatalogView,
          selection?: SessionResourceRouteSelection | null,
        ) =>
          Effect.sync(() =>
            selection === undefined
              ? handlerMocks.findById(sessionId, resourceId, view)
              : handlerMocks.findById(sessionId, resourceId, view, selection),
          ),
        locateImage: (
          sessionId: SessionId,
          resourceId: string,
          selection?: SessionResourceRouteSelection | null,
        ) =>
          Effect.sync(() =>
            selection === undefined
              ? handlerMocks.locateImage(sessionId, resourceId)
              : handlerMocks.locateImage(sessionId, resourceId, selection),
          ),
        findByOccurrence: () => Effect.succeed(null),
        findByLocator: (sessionId: SessionId, kind: SessionResourceKind, locator: string) =>
          Effect.sync(
            () =>
              handlerMocks
                .list(sessionId)
                .find(
                  (resource: { readonly kind: string; readonly locator: string | null }) =>
                    resource.kind === kind && resource.locator === locator,
                ) ?? null,
          ),
        getContentLocation: (sessionId: SessionId, resourceId: string) =>
          Effect.sync(() => handlerMocks.getContentLocation(sessionId, resourceId)),
        getBackfillCursor: (sessionId: SessionId) =>
          Effect.sync(() => handlerMocks.getBackfillCursor(sessionId)),
        advanceBackfillCursor: (sessionId: SessionId, throughCreatedOrder: number) =>
          Effect.sync(() => handlerMocks.advanceBackfillCursor(sessionId, throughCreatedOrder)),
        upsert: (input: UpsertSessionResourceInput) =>
          Effect.suspend(() => {
            const result = handlerMocks.upsert(input)
            return result instanceof SessionResourceRepositoryError
              ? Effect.fail(result)
              : Effect.succeed({
                  ...input,
                  occurrences: [input.occurrence],
                  isSource:
                    input.occurrence.activity === 'provided' ||
                    input.occurrence.activity === 'read',
                  isOutput:
                    input.occurrence.activity === 'created' ||
                    input.occurrence.activity === 'updated',
                })
          }),
        hasOccurrence: () => Effect.succeed(false),
        hasOccurrences: () => Effect.succeed(new Set()),
        findByOccurrences: () => Effect.succeed([]),
        listByNodeIds: () => Effect.succeed([]),
        listByNodeIdsPage: (sessionId: SessionId, input: SessionResourceNodePageRequest) =>
          Effect.sync(() => handlerMocks.listByNodeIdsPage(sessionId, input)),
        listManagedNodeIds: () => Effect.succeed([]),
        findByCanonicalKey: () => Effect.succeed(null),
      }),
    ),
  ),
  Layer.succeed(
    SessionResourceStore,
    SessionResourceStore.of(
      fromPartial<SessionResourceStoreShape>({
        inspect: (managedPath: string) => Effect.sync(() => handlerMocks.inspect(managedPath)),
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
  const sender = fromPartial<WebContents>(handlerSender)
  const event = fromPartial<IpcMainInvokeEvent>({ sender })
  return Effect.runPromise(Effect.provide(handler(event, ...args), TestLayer))
}

export function invokeSessionResourceOwnerHandler(sessionId: unknown) {
  const handler = handlerMocks.typedOn.mock.calls.find(
    (call) => call[0] === 'sessions:resources:activate-owner',
  )?.[1]
  if (typeof handler !== 'function') throw new Error('Missing Session resource owner handler')
  const sender = fromPartial<WebContents>(handlerSender)
  const event = fromPartial<IpcMainEvent>({ sender })
  return Effect.runPromise(Effect.provide(handler(event, sessionId), TestLayer))
}

export function resetSessionResourceHandlerHarness() {
  handlerSenderId += 1
  handlerSender = Object.assign(new EventEmitter(), { id: handlerSenderId })
  handlerMocks.pendingOutputs.splice(0)
  handlerMocks.typedHandle.mockClear()
  handlerMocks.typedOn.mockClear()
  handlerMocks.list.mockReset().mockReturnValue([])
  handlerMocks.listPage.mockReset()
  handlerMocks.findById.mockReset().mockReturnValue(null)
  handlerMocks.locateImage.mockReset().mockReturnValue(null)
  handlerMocks.listByNodeIdsPage.mockReset().mockReturnValue({
    resources: [],
    total: 0,
    nextCursor: null,
    orderRevision: 'none',
  })
  handlerMocks.getContentLocation.mockReset().mockReturnValue(null)
  handlerMocks.inspect.mockReset().mockReturnValue(undefined)
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
