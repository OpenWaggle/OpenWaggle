import { decodeUnknownOrThrow } from '@shared/schema'
import {
  sessionResourceIdSchema,
  sessionResourceSessionIdSchema,
} from '@shared/schemas/session-resource'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { clipboard, nativeImage } from 'electron'
import {
  prepareSessionResourceContent,
  readSessionResourceContentBytes,
  readSessionResourceThumbnail,
} from '../application/session-resource-content'
import { SessionResourceRepository } from '../ports/session-resource-repository'
import { SessionResourceStore } from '../ports/session-resource-store'
import {
  activateSessionResourceContentOwner,
  beginSessionResourceContentRequest,
} from '../session-resource-owner-lifecycle'
import { registerSessionResourceContentReference } from '../session-resource-protocol'
import {
  discardRegisteredImageAttachment,
  prepareRegisteredImageAttachmentFromBytes,
} from './attachments-handler'
import { typedHandle, typedOn } from './typed-ipc'

function requireAvailableImage(sessionId: SessionId, resourceId: string) {
  return Effect.gen(function* () {
    const repository = yield* SessionResourceRepository
    const resource = yield* repository.findById(sessionId, resourceId, 'images')
    if (resource?.kind !== 'image') {
      return yield* Effect.fail(new Error('The requested Session resource is not an image.'))
    }
    if (!resource.available) {
      return yield* Effect.fail(new Error('The requested Session image is unavailable.'))
    }
    return resource
  })
}

function decodeResourceTarget(rawSessionId: unknown, rawResourceId: unknown) {
  return {
    sessionId: SessionId(decodeUnknownOrThrow(sessionResourceSessionIdSchema, rawSessionId)),
    resourceId: decodeUnknownOrThrow(sessionResourceIdSchema, rawResourceId),
  }
}

function inactiveSessionResourceError() {
  return new Error('The requested Session resource is no longer owned by the opened Session.')
}

export function registerSessionResourceImageHandlers() {
  typedOn('sessions:resources:activate-owner', (event, rawSessionId: unknown) =>
    Effect.sync(() => {
      const sessionId =
        rawSessionId === null
          ? null
          : SessionId(decodeUnknownOrThrow(sessionResourceSessionIdSchema, rawSessionId))
      activateSessionResourceContentOwner(event.sender, sessionId)
    }),
  )

  typedHandle('sessions:resources:read', (event, rawSessionId: unknown, rawResourceId: unknown) =>
    Effect.gen(function* () {
      const { sessionId, resourceId } = decodeResourceTarget(rawSessionId, rawResourceId)
      const request = beginSessionResourceContentRequest(event.sender, sessionId)
      if (!request.isCurrent()) return null
      const location = yield* prepareSessionResourceContent(sessionId, resourceId)
      if (!location || !request.isCurrent()) return null
      return registerSessionResourceContentReference(location, event.sender.id)
    }),
  )

  typedHandle(
    'sessions:resources:thumbnail',
    (event, rawSessionId: unknown, rawResourceId: unknown) =>
      Effect.gen(function* () {
        const { sessionId, resourceId } = decodeResourceTarget(rawSessionId, rawResourceId)
        const request = beginSessionResourceContentRequest(event.sender, sessionId)
        if (!request.isCurrent()) return null
        const thumbnail = yield* readSessionResourceThumbnail(sessionId, resourceId)
        return request.isCurrent() ? thumbnail : null
      }),
  )

  typedHandle(
    'sessions:resources:copy-image',
    (event, rawSessionId: unknown, rawResourceId: unknown) =>
      Effect.gen(function* () {
        const { sessionId, resourceId } = decodeResourceTarget(rawSessionId, rawResourceId)
        const request = beginSessionResourceContentRequest(event.sender, sessionId)
        if (!request.isCurrent()) return yield* Effect.fail(inactiveSessionResourceError())
        yield* requireAvailableImage(sessionId, resourceId)
        const content = yield* readSessionResourceContentBytes(sessionId, resourceId)
        if (!content?.mimeType.toLowerCase().startsWith('image/')) {
          return yield* Effect.fail(new Error('The requested Session image could not be read.'))
        }
        if (!request.isCurrent()) return yield* Effect.fail(inactiveSessionResourceError())
        yield* Effect.sync(() => {
          const image = nativeImage.createFromBuffer(Buffer.from(content.bytes))
          if (image.isEmpty()) throw new Error('The requested Session image could not be decoded.')
          clipboard.writeImage(image)
        })
      }),
  )

  typedHandle(
    'sessions:resources:prepare-attachment',
    (event, rawSessionId: unknown, rawResourceId: unknown) =>
      Effect.gen(function* () {
        const { sessionId, resourceId } = decodeResourceTarget(rawSessionId, rawResourceId)
        const request = beginSessionResourceContentRequest(event.sender, sessionId)
        if (!request.isCurrent()) return yield* Effect.fail(inactiveSessionResourceError())
        yield* requireAvailableImage(sessionId, resourceId)
        const repository = yield* SessionResourceRepository
        let location = yield* repository.getContentLocation(sessionId, resourceId)
        if (!location) {
          location = yield* prepareSessionResourceContent(sessionId, resourceId)
        }
        if (!location) {
          return yield* Effect.fail(
            new Error('The requested Session image has no managed attachment copy.'),
          )
        }
        const store = yield* SessionResourceStore
        const bytes = yield* store.read(location.managedPath)
        if (!request.isCurrent()) return yield* Effect.fail(inactiveSessionResourceError())
        const prepared = yield* Effect.promise(() =>
          prepareRegisteredImageAttachmentFromBytes({
            bytes,
            fileName: location.fileName,
            mimeType: location.mimeType,
          }),
        )
        if (request.isCurrent()) return prepared
        yield* Effect.promise(() => discardRegisteredImageAttachment(prepared))
        return yield* Effect.fail(inactiveSessionResourceError())
      }),
  )
}
