import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

const handlerMocks = vi.hoisted(() => ({
  typedHandle: vi.fn(),
  list: vi.fn(),
  getContentLocation: vi.fn(),
  read: vi.fn(),
  thumbnail: vi.fn(),
  listResourceProjectionPage: vi.fn(),
  getResourceProjectionNodes: vi.fn(),
  getBackfillCursor: vi.fn(),
  advanceBackfillCursor: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({ typedHandle: handlerMocks.typedHandle }))

const TestLayer = Layer.mergeAll(
  Layer.succeed(
    SessionRepository,
    SessionRepository.of(
      fromPartial<SessionRepositoryShape>({
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
          Effect.succeed({
            ...input,
            occurrences: [input.occurrence],
            isSource:
              input.occurrence.activity === 'provided' || input.occurrence.activity === 'read',
            isOutput:
              input.occurrence.activity === 'created' || input.occurrence.activity === 'updated',
          }),
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

function invoke(channel: string, ...args: readonly unknown[]) {
  const handler = handlerMocks.typedHandle.mock.calls.find((call) => call[0] === channel)?.[1]
  if (typeof handler !== 'function') throw new Error(`Missing handler for ${channel}`)
  return Effect.runPromise(Effect.provide(handler({}, ...args), TestLayer))
}

function emptyProjectionPage(hasMore: boolean) {
  return { nodes: [], throughCreatedOrder: 41, hasMore }
}

describe('session resource IPC handlers', () => {
  beforeEach(() => {
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
    registerSessionResourceHandlers()
  })

  it('rejects malformed and traversal-like session/resource identifiers at the IPC boundary', async () => {
    await expect(invoke('sessions:resources:list', '../another-session')).rejects.toBeDefined()
    await expect(
      invoke('sessions:resources:read', SessionId('session-one'), '../../secret'),
    ).rejects.toBeDefined()
    await expect(
      invoke('sessions:resources:thumbnail', SessionId('session-one'), '../../secret'),
    ).rejects.toBeDefined()
    await expect(
      invoke('sessions:resources:retry', SessionId('session-one'), '../../secret'),
    ).rejects.toBeDefined()
    expect(handlerMocks.list).not.toHaveBeenCalled()
    expect(handlerMocks.getContentLocation).not.toHaveBeenCalled()
  })

  it('rejects invalid change-request metadata at the IPC boundary', async () => {
    expect(() =>
      invoke('sessions:resources:record-change-request', SessionId('session-one'), {
        title: ' ',
        url: 'javascript:alert(1)',
      }),
    ).toThrow()
  })

  it('passes validated identifiers to the session-scoped repository lookup', async () => {
    await expect(
      invoke('sessions:resources:read', SessionId('session-one'), 'resource-one'),
    ).resolves.toBeNull()
    expect(handlerMocks.getContentLocation).toHaveBeenCalledWith(
      SessionId('session-one'),
      'resource-one',
    )
    expect(handlerMocks.list).toHaveBeenCalledWith(SessionId('session-one'))
  })

  it('backfills one persisted page instead of hydrating the complete session tree', async () => {
    handlerMocks.getBackfillCursor.mockReturnValue(23)
    handlerMocks.listResourceProjectionPage.mockReturnValue(emptyProjectionPage(false))

    await expect(invoke('sessions:resources:list', SessionId('session-one'))).resolves.toEqual({
      resources: [],
      backfillComplete: true,
    })

    expect(handlerMocks.listResourceProjectionPage).toHaveBeenCalledWith(
      SessionId('session-one'),
      23,
      SESSION_RESOURCE_BACKFILL_PAGE_SIZE,
    )
    expect(handlerMocks.advanceBackfillCursor).toHaveBeenCalledWith(SessionId('session-one'), 41)
  })

  it('keeps polling after a fully projected page when persisted history remains', async () => {
    handlerMocks.listResourceProjectionPage.mockReturnValue(emptyProjectionPage(true))

    await expect(invoke('sessions:resources:list', SessionId('session-one'))).resolves.toEqual({
      resources: [],
      backfillComplete: false,
    })

    expect(handlerMocks.advanceBackfillCursor).toHaveBeenCalledWith(SessionId('session-one'), 41)
    handlerMocks.list.mockClear()
    await expect(invoke('sessions:resources:backfill', SessionId('session-one'))).resolves.toEqual({
      backfillComplete: false,
    })
    expect(handlerMocks.list).toHaveBeenCalledOnce()
  })

  it('looks up retry provenance only inside the requested session', async () => {
    handlerMocks.list.mockReturnValue([
      {
        id: 'resource-one',
        sessionId: SessionId('session-one'),
        canonicalKey: 'file:/input/missing.png',
        kind: 'image',
        title: 'missing.png',
        mimeType: 'image/png',
        locator: '/input/missing.png',
        available: false,
        isSource: true,
        isOutput: false,
        occurrences: [
          {
            id: 'occurrence-one',
            nodeId: 'node-one',
            branchId: null,
            actor: 'user',
            activity: 'provided',
            label: null,
            createdAt: 1,
          },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    await expect(
      invoke('sessions:resources:retry', SessionId('session-one'), 'resource-one'),
    ).resolves.toBeUndefined()

    expect(handlerMocks.list).toHaveBeenCalledWith(SessionId('session-one'))
    expect(handlerMocks.getResourceProjectionNodes).toHaveBeenCalledOnce()
  })

  it('does not advance the page cursor when a capture budget leaves work pending', async () => {
    const markdown = Array.from(
      { length: 33 },
      (_, index) => `[Link](https://example.test/${String(index)})`,
    ).join('\n')
    handlerMocks.listResourceProjectionPage.mockReturnValue({
      nodes: [
        {
          id: 'assistant-node',
          branchId: null,
          message: {
            id: 'assistant-node',
            role: 'assistant',
            parts: [{ type: 'text', text: markdown }],
            createdAt: 1000,
          },
        },
      ],
      throughCreatedOrder: 41,
      hasMore: false,
    })

    await expect(invoke('sessions:resources:list', SessionId('session-one'))).resolves.toEqual({
      resources: [],
      backfillComplete: false,
    })

    expect(handlerMocks.advanceBackfillCursor).not.toHaveBeenCalled()
  })

  it('keeps polling the same page after a transient capture failure', async () => {
    handlerMocks.listResourceProjectionPage.mockReturnValue({
      nodes: [
        {
          id: 'assistant-node',
          branchId: null,
          message: {
            id: 'assistant-node',
            role: 'assistant',
            parts: [{ type: 'text', text: '[Docs](https://example.test/docs)' }],
            createdAt: 1000,
          },
        },
      ],
      throughCreatedOrder: 41,
      hasMore: false,
    })
    handlerMocks.list
      .mockImplementationOnce(() => {
        throw new Error('database temporarily unavailable')
      })
      .mockReturnValue([])

    await expect(invoke('sessions:resources:list', SessionId('session-one'))).resolves.toEqual({
      resources: [],
      backfillComplete: false,
    })

    expect(handlerMocks.advanceBackfillCursor).not.toHaveBeenCalled()
  })

  it('returns a bounded thumbnail for managed content in the requested session', async () => {
    handlerMocks.getContentLocation.mockReturnValue({
      resourceId: 'resource-one',
      sessionId: SessionId('session-one'),
      fileName: 'image.png',
      mimeType: 'image/png',
      managedPath: '/managed/image.png',
    })

    await expect(
      invoke('sessions:resources:thumbnail', SessionId('session-one'), 'resource-one'),
    ).resolves.toEqual({
      resourceId: 'resource-one',
      fileName: 'resource-one-thumbnail.webp',
      mimeType: 'image/webp',
      dataBase64: Buffer.from('thumbnail').toString('base64'),
    })
    expect(handlerMocks.getContentLocation).toHaveBeenCalledWith(
      SessionId('session-one'),
      'resource-one',
    )
    expect(handlerMocks.read).toHaveBeenCalledWith('/managed/image.png')
    expect(handlerMocks.thumbnail).toHaveBeenCalledWith(Buffer.from('full-image'), 'image/png')
  })
})
