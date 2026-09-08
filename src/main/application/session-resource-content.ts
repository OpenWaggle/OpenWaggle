import type { SessionId } from '@shared/types/brand'
import type {
  SessionResource,
  SessionResourceThumbnailPreview,
} from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { SessionResourceImageFetcher } from '../ports/session-resource-image-fetcher'
import {
  type SessionResourceContentLocation,
  SessionResourceRepository,
} from '../ports/session-resource-repository'
import { SessionResourceStore } from '../ports/session-resource-store'
import { SessionResourceThumbnailer } from '../ports/session-resource-thumbnailer'
import { removeReplacedCopy } from './session-resource-capture-shared'
import { withSessionResourceInvalidation } from './session-resource-invalidation'
import { withSessionResourceLock } from './session-resource-lock'

function thumbnailFromBytes(
  resourceId: string,
  fileName: string,
  mimeType: string,
  bytes: Uint8Array,
): SessionResourceThumbnailPreview {
  return {
    resourceId,
    fileName,
    mimeType,
    dataBase64: Buffer.from(bytes).toString('base64'),
  }
}

function remoteImageUrl(resource: SessionResource) {
  if (resource.locator?.startsWith('https://')) return resource.locator
  for (const prefix of ['image-url:', 'url:']) {
    if (resource.canonicalKey.startsWith(`${prefix}https://`)) {
      return resource.canonicalKey.slice(prefix.length)
    }
  }
  return null
}

function inspectManagedContent(location: SessionResourceContentLocation) {
  return SessionResourceStore.pipe(
    Effect.flatMap((store) => store.inspect(location.managedPath)),
    Effect.as(location),
    Effect.catchAll(() => Effect.succeed(null)),
  )
}

function readManagedThumbnail(location: SessionResourceContentLocation) {
  if (!location.mimeType.toLowerCase().startsWith('image/')) return Effect.succeed(null)
  return Effect.gen(function* () {
    const bytes = yield* SessionResourceStore.pipe(
      Effect.flatMap((store) => store.read(location.managedPath)),
    )
    const thumbnail = yield* SessionResourceThumbnailer.pipe(
      Effect.flatMap((thumbnailer) => thumbnailer.create(bytes, location.mimeType)),
    )
    return thumbnailFromBytes(
      location.resourceId,
      `${location.resourceId}-thumbnail.webp`,
      thumbnail.mimeType,
      thumbnail.bytes,
    )
  }).pipe(Effect.catchAll(() => Effect.succeed(null)))
}

function materializeRemoteImage(
  sessionId: SessionId,
  resource: SessionResource,
  previousLocation: SessionResourceContentLocation | null,
  url: string,
) {
  return Effect.gen(function* () {
    const occurrence = resource.occurrences[0]
    if (!occurrence) return null
    const fetched = yield* SessionResourceImageFetcher.pipe(
      Effect.flatMap((fetcher) => fetcher.fetch(url)),
    )
    const store = yield* SessionResourceStore
    const stored = yield* store.storeBytes({
      sessionId,
      resourceId: resource.id,
      fileName: fetched.fileName,
      bytes: fetched.bytes,
    })
    yield* SessionResourceRepository.pipe(
      Effect.flatMap((repository) =>
        repository.upsert({
          id: resource.id,
          sessionId,
          canonicalKey: resource.canonicalKey,
          kind: 'image',
          title: resource.title === url ? fetched.fileName : resource.title,
          mimeType: fetched.mimeType,
          locator: url,
          managedPath: stored.path,
          available: true,
          occurrence,
          createdAt: resource.createdAt,
          updatedAt: Date.now(),
        }),
      ),
      Effect.tapError(() => store.remove(stored.path).pipe(Effect.catchAll(() => Effect.void))),
    )
    yield* removeReplacedCopy(store, previousLocation?.managedPath, stored.path)
    return {
      resourceId: resource.id,
      sessionId,
      fileName: fetched.fileName,
      mimeType: fetched.mimeType,
      managedPath: stored.path,
    } satisfies SessionResourceContentLocation
  })
}

function prepareSessionResourceContentUnlocked(sessionId: SessionId, resourceId: string) {
  return withSessionResourceInvalidation(
    sessionId,
    Effect.gen(function* () {
      const repository = yield* SessionResourceRepository
      const location = yield* repository.getContentLocation(sessionId, resourceId)
      if (location) {
        const content = yield* inspectManagedContent(location)
        if (content) return content
      }
      const resource = yield* repository.findById(sessionId, resourceId, 'images')
      if (resource?.kind !== 'image') return null
      const url = remoteImageUrl(resource)
      if (!url) return null
      return yield* materializeRemoteImage(sessionId, resource, location, url)
    }),
  )
}

/** Ensures an explicitly requested resource has a readable managed copy without returning bytes. */
export function prepareSessionResourceContent(sessionId: SessionId, resourceId: string) {
  return withSessionResourceLock(
    sessionId,
    prepareSessionResourceContentUnlocked(sessionId, resourceId),
  )
}

/** Binary-only main-process read for native actions and protocol responses. */
export function readSessionResourceContentBytes(sessionId: SessionId, resourceId: string) {
  return withSessionResourceLock(
    sessionId,
    Effect.gen(function* () {
      const location = yield* prepareSessionResourceContentUnlocked(sessionId, resourceId)
      if (!location) return null
      const bytes = yield* SessionResourceStore.pipe(
        Effect.flatMap((store) => store.read(location.managedPath)),
        Effect.catchAll(() => Effect.succeed(null)),
      )
      return bytes ? { ...location, bytes } : null
    }),
  )
}

/** Opens a fresh confined stream for Electron's Session resource protocol. */
export function openSessionResourceContentStream(sessionId: SessionId, resourceId: string) {
  return withSessionResourceLock(
    sessionId,
    withSessionResourceInvalidation(
      sessionId,
      Effect.gen(function* () {
        const repository = yield* SessionResourceRepository
        const store = yield* SessionResourceStore
        const existing = yield* repository.getContentLocation(sessionId, resourceId)
        if (existing) {
          const body = yield* store
            .openReadStream(existing.managedPath)
            .pipe(Effect.catchAll(() => Effect.succeed(null)))
          if (body) return { ...existing, body }
        }
        const resource = yield* repository.findById(sessionId, resourceId, 'images')
        if (resource?.kind !== 'image') return null
        const url = remoteImageUrl(resource)
        if (!url) return null
        const materialized = yield* materializeRemoteImage(sessionId, resource, existing, url)
        if (!materialized) return null
        const body = yield* store
          .openReadStream(materialized.managedPath)
          .pipe(Effect.catchAll(() => Effect.succeed(null)))
        return body ? { ...materialized, body } : null
      }),
    ),
  )
}

/** Reads only managed content and returns a bounded preview; remote images stay lazy. */
export function readSessionResourceThumbnail(sessionId: SessionId, resourceId: string) {
  return withSessionResourceLock(
    sessionId,
    Effect.gen(function* () {
      const location = yield* SessionResourceRepository.pipe(
        Effect.flatMap((repository) => repository.getContentLocation(sessionId, resourceId)),
      )
      return location ? yield* readManagedThumbnail(location) : null
    }),
  )
}
