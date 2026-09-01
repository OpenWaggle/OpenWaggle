import type { SessionId } from '@shared/types/brand'
import type { SessionResource, SessionResourceContent } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { SessionResourceImageFetcher } from '../ports/session-resource-image-fetcher'
import {
  type SessionResourceContentLocation,
  SessionResourceRepository,
} from '../ports/session-resource-repository'
import { SessionResourceStore } from '../ports/session-resource-store'
import { SessionResourceThumbnailer } from '../ports/session-resource-thumbnailer'
import { removeReplacedCopy } from './session-resource-capture-shared'
import { withSessionResourceLock } from './session-resource-lock'

function contentFromBytes(
  resourceId: string,
  fileName: string,
  mimeType: string,
  bytes: Uint8Array,
): SessionResourceContent {
  return {
    resourceId,
    fileName,
    mimeType,
    dataBase64: Buffer.from(bytes).toString('base64'),
  }
}

function remoteImageUrl(resource: SessionResource) {
  if (resource.locator?.startsWith('https://')) return resource.locator
  if (resource.canonicalKey.startsWith('url:https://')) {
    return resource.canonicalKey.slice('url:'.length)
  }
  return null
}

function readManagedContent(location: SessionResourceContentLocation) {
  return SessionResourceStore.pipe(
    Effect.flatMap((store) => store.read(location.managedPath)),
    Effect.map((bytes) =>
      contentFromBytes(location.resourceId, location.fileName, location.mimeType, bytes),
    ),
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
    return contentFromBytes(
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
    return contentFromBytes(resource.id, fetched.fileName, fetched.mimeType, fetched.bytes)
  })
}

export function readSessionResourceContent(sessionId: SessionId, resourceId: string) {
  return withSessionResourceLock(
    sessionId,
    Effect.gen(function* () {
      const repository = yield* SessionResourceRepository
      const location = yield* repository.getContentLocation(sessionId, resourceId)
      if (location) {
        const content = yield* readManagedContent(location)
        if (content) return content
      }
      const resource = (yield* repository.list(sessionId)).find((item) => item.id === resourceId)
      if (resource?.kind !== 'image') return null
      const url = remoteImageUrl(resource)
      if (!url) return null
      const occurrence = resource.occurrences[0]
      if (!occurrence) return null
      return yield* materializeRemoteImage(sessionId, resource, location, url).pipe(
        Effect.tapError(() =>
          repository
            .upsert({
              id: resource.id,
              sessionId,
              canonicalKey: resource.canonicalKey,
              kind: resource.kind,
              title: resource.title,
              mimeType: resource.mimeType,
              locator: url,
              managedPath: null,
              available: false,
              occurrence,
              createdAt: resource.createdAt,
              updatedAt: Date.now(),
            })
            .pipe(Effect.catchAll(() => Effect.void)),
        ),
      )
    }),
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
