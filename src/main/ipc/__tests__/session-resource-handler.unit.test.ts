import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionRepository, type SessionRepositoryShape } from '../../ports/session-repository'
import {
  SessionResourceImageFetcher,
  type SessionResourceImageFetcherShape,
} from '../../ports/session-resource-image-fetcher'
import {
  SessionResourceRepository,
  type SessionResourceRepositoryShape,
} from '../../ports/session-resource-repository'
import {
  SessionResourceStore,
  type SessionResourceStoreShape,
} from '../../ports/session-resource-store'
import {
  SessionResourceThumbnailer,
  type SessionResourceThumbnailerShape,
} from '../../ports/session-resource-thumbnailer'
import { registerSessionResourceHandlers } from '../session-resource-handler'

const handlerMocks = vi.hoisted(() => ({
  typedHandle: vi.fn(),
  list: vi.fn(),
  getContentLocation: vi.fn(),
  read: vi.fn(),
  thumbnail: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({ typedHandle: handlerMocks.typedHandle }))

const TestLayer = Layer.mergeAll(
  Layer.succeed(
    SessionRepository,
    SessionRepository.of(
      fromPartial<SessionRepositoryShape>({ getTree: () => Effect.succeed(null) }),
    ),
  ),
  Layer.succeed(
    SessionResourceRepository,
    SessionResourceRepository.of(
      fromPartial<SessionResourceRepositoryShape>({
        list: (sessionId: SessionId) => Effect.sync(() => handlerMocks.list(sessionId)),
        getContentLocation: (sessionId: SessionId, resourceId: string) =>
          Effect.sync(() => handlerMocks.getContentLocation(sessionId, resourceId)),
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

describe('session resource IPC handlers', () => {
  beforeEach(() => {
    handlerMocks.typedHandle.mockClear()
    handlerMocks.list.mockReset().mockReturnValue([])
    handlerMocks.getContentLocation.mockReset().mockReturnValue(null)
    handlerMocks.read.mockReset().mockReturnValue(Buffer.from('full-image'))
    handlerMocks.thumbnail
      .mockReset()
      .mockReturnValue({ bytes: Buffer.from('thumbnail'), mimeType: 'image/webp' })
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
