import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import { SessionResourceImageFetchError } from '../../errors'
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
  readSessionResourceContent,
  readSessionResourceThumbnail,
} from '../session-resource-content'
import { PNG_BASE64 } from './session-resource-capture.fixtures'

const SESSION_ID = SessionId('session-one')
const REMOTE_RESOURCE: SessionResource = {
  id: 'remote-image',
  sessionId: SESSION_ID,
  canonicalKey: 'url:https://images.example/architecture.png',
  kind: 'image',
  title: 'Architecture',
  mimeType: null,
  locator: 'https://images.example/architecture.png',
  managed: false,
  available: true,
  isSource: true,
  isOutput: false,
  occurrences: [
    {
      id: 'occurrence-one',
      nodeId: 'assistant-one',
      branchId: null,
      actor: 'agent',
      activity: 'read',
      label: null,
      createdAt: 1000,
    },
  ],
  createdAt: 1000,
  updatedAt: 1000,
}

function contentLayer(input: {
  readonly resource?: SessionResource
  readonly location?: {
    readonly resourceId: string
    readonly sessionId: typeof SESSION_ID
    readonly fileName: string
    readonly mimeType: string
    readonly managedPath: string
  } | null
  readonly fetch?: ReturnType<typeof vi.fn>
  readonly read?: ReturnType<typeof vi.fn>
  readonly storeBytes?: ReturnType<typeof vi.fn>
  readonly upsert?: ReturnType<typeof vi.fn>
  readonly thumbnail?: ReturnType<typeof vi.fn>
}) {
  const resource = input.resource ?? REMOTE_RESOURCE
  const fetch =
    input.fetch ??
    vi.fn(() =>
      Effect.succeed({
        bytes: Buffer.from(PNG_BASE64, 'base64'),
        mimeType: 'image/png',
        fileName: 'architecture.png',
      }),
    )
  const read = input.read ?? vi.fn(() => Effect.succeed(Buffer.from(PNG_BASE64, 'base64')))
  const storeBytes =
    input.storeBytes ??
    vi.fn(() =>
      Effect.succeed({
        path: '/managed/remote-image-architecture.png',
        sha256: 'digest',
        sizeBytes: 68,
      }),
    )
  const upsert =
    input.upsert ??
    vi.fn((resource: UpsertSessionResourceInput) =>
      Effect.succeed({
        ...resource,
        ...resource,
        occurrences: [resource.occurrence],
      }),
    )
  const thumbnail =
    input.thumbnail ??
    vi.fn(() =>
      Effect.succeed({ bytes: Buffer.from('bounded-thumbnail'), mimeType: 'image/webp' as const }),
    )
  const layer = Layer.mergeAll(
    Layer.succeed(
      SessionResourceImageFetcher,
      SessionResourceImageFetcher.of(fromPartial<SessionResourceImageFetcherShape>({ fetch })),
    ),
    Layer.succeed(
      SessionResourceRepository,
      SessionResourceRepository.of(
        fromPartial<SessionResourceRepositoryShape>({
          getContentLocation: () => Effect.succeed(input.location ?? null),
          list: () => Effect.succeed([resource]),
          upsert,
        }),
      ),
    ),
    Layer.succeed(
      SessionResourceStore,
      SessionResourceStore.of(
        fromPartial<SessionResourceStoreShape>({
          read,
          storeBytes,
          remove: () => Effect.void,
        }),
      ),
    ),
    Layer.succeed(
      SessionResourceThumbnailer,
      SessionResourceThumbnailer.of(
        fromPartial<SessionResourceThumbnailerShape>({ create: thumbnail }),
      ),
    ),
  )
  return { fetch, layer, read, storeBytes, thumbnail, upsert }
}

describe('readSessionResourceContent', () => {
  it('materializes an image-specific canonical URL when the legacy locator is absent', async () => {
    const resource = {
      ...REMOTE_RESOURCE,
      canonicalKey: 'image-url:https://images.example/architecture.png',
      locator: null,
    }
    const test = contentLayer({ resource })

    await Effect.runPromise(
      readSessionResourceContent(SESSION_ID, resource.id).pipe(Effect.provide(test.layer)),
    )

    expect(test.fetch).toHaveBeenCalledWith('https://images.example/architecture.png')
  })

  it('fetches and persists a remote image only when content is explicitly requested', async () => {
    const test = contentLayer({})

    const content = await Effect.runPromise(
      readSessionResourceContent(SESSION_ID, REMOTE_RESOURCE.id).pipe(Effect.provide(test.layer)),
    )

    expect(content).toEqual({
      resourceId: REMOTE_RESOURCE.id,
      fileName: 'architecture.png',
      mimeType: 'image/png',
      dataBase64: PNG_BASE64,
    })
    expect(test.fetch).toHaveBeenCalledWith('https://images.example/architecture.png')
    expect(test.storeBytes).toHaveBeenCalledOnce()
    expect(test.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: REMOTE_RESOURCE.id,
        locator: 'https://images.example/architecture.png',
        managedPath: '/managed/remote-image-architecture.png',
      }),
    )
  })

  it('serves an existing managed copy without making a network request', async () => {
    const test = contentLayer({
      location: {
        resourceId: REMOTE_RESOURCE.id,
        sessionId: SESSION_ID,
        fileName: 'architecture.png',
        mimeType: 'image/png',
        managedPath: '/managed/remote-image-architecture.png',
      },
    })

    await Effect.runPromise(
      readSessionResourceContent(SESSION_ID, REMOTE_RESOURCE.id).pipe(Effect.provide(test.layer)),
    )

    expect(test.read).toHaveBeenCalledWith('/managed/remote-image-architecture.png')
    expect(test.fetch).not.toHaveBeenCalled()
    expect(test.storeBytes).not.toHaveBeenCalled()
    expect(test.upsert).not.toHaveBeenCalled()
  })

  it('returns only the thumbnailer output for a managed preview', async () => {
    const location = {
      resourceId: REMOTE_RESOURCE.id,
      sessionId: SESSION_ID,
      fileName: 'architecture.png',
      mimeType: 'image/png',
      managedPath: '/managed/remote-image-architecture.png',
    } as const
    const test = contentLayer({ location })

    const content = await Effect.runPromise(
      readSessionResourceThumbnail(SESSION_ID, REMOTE_RESOURCE.id).pipe(Effect.provide(test.layer)),
    )

    expect(content).toEqual({
      resourceId: REMOTE_RESOURCE.id,
      fileName: `${REMOTE_RESOURCE.id}-thumbnail.webp`,
      mimeType: 'image/webp',
      dataBase64: Buffer.from('bounded-thumbnail').toString('base64'),
    })
    expect(test.read).toHaveBeenCalledWith(location.managedPath)
    expect(test.thumbnail).toHaveBeenCalledWith(Buffer.from(PNG_BASE64, 'base64'), 'image/png')
    expect(test.fetch).not.toHaveBeenCalled()
  })

  it('does not materialize a remote image merely to create a preview', async () => {
    const test = contentLayer({})

    await expect(
      Effect.runPromise(
        readSessionResourceThumbnail(SESSION_ID, REMOTE_RESOURCE.id).pipe(
          Effect.provide(test.layer),
        ),
      ),
    ).resolves.toBeNull()
    expect(test.fetch).not.toHaveBeenCalled()
    expect(test.thumbnail).not.toHaveBeenCalled()
  })

  it('persists a failed remote fetch as unavailable while retaining its original URL', async () => {
    const test = contentLayer({
      fetch: vi.fn(() =>
        Effect.fail(
          new SessionResourceImageFetchError({
            url: REMOTE_RESOURCE.locator ?? '',
            cause: new Error('offline'),
          }),
        ),
      ),
    })

    await expect(
      Effect.runPromise(
        readSessionResourceContent(SESSION_ID, REMOTE_RESOURCE.id).pipe(Effect.provide(test.layer)),
      ),
    ).rejects.toBeDefined()

    expect(test.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: REMOTE_RESOURCE.id,
        locator: REMOTE_RESOURCE.locator,
        managedPath: null,
        available: false,
      }),
    )
  })
})
