import { decodeUnknownOrThrow } from '@shared/schema'
import {
  sessionResourceIdSchema,
  sessionResourceSessionIdSchema,
} from '@shared/schemas/session-resource'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { clipboard, nativeImage } from 'electron'
import {
  readHostSessionResourceContent,
  readHostSessionResourceThumbnail,
} from '../application/host-ui-session-resource-content-client'
import {
  prepareSessionResourceContent,
  readSessionResourceContentBytes,
  readSessionResourceThumbnail,
} from '../application/session-resource-content'
import { SessionResourceRepository } from '../ports/session-resource-repository'
import { preferredSessionResourceFileName } from '../session-resource-content-disposition'
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

function readAvailableImageContent(sessionId: SessionId, resourceId: string) {
  return Effect.gen(function* () {
    const remote = yield* Effect.tryPromise(() =>
      readHostSessionResourceContent(sessionId, resourceId),
    )
    if (remote.handled) return remote.content
    yield* requireAvailableImage(sessionId, resourceId)
    return yield* readSessionResourceContentBytes(sessionId, resourceId)
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

  typedHandle(
    'sessions:resources:read',
    (event, rawSessionId: unknown, rawResourceId: unknown, rawPreferredFileName?: unknown) =>
      Effect.gen(function* () {
        const { sessionId, resourceId } = decodeResourceTarget(rawSessionId, rawResourceId)
        const request = beginSessionResourceContentRequest(event.sender, sessionId)
        if (!request.isCurrent()) return null
        const remote = yield* Effect.tryPromise(() =>
          readHostSessionResourceContent(sessionId, resourceId),
        )
        const content = remote.handled
          ? remote.content
          : yield* prepareSessionResourceContent(sessionId, resourceId)
        if (!content || !request.isCurrent()) return null
        return registerSessionResourceContentReference(
          {
            sessionId,
            resourceId: content.resourceId,
            mimeType: content.mimeType,
            fileName: preferredSessionResourceFileName(rawPreferredFileName) ?? content.fileName,
          },
          event.sender.id,
        )
      }),
  )

  typedHandle(
    'sessions:resources:thumbnail',
    (event, rawSessionId: unknown, rawResourceId: unknown) =>
      Effect.gen(function* () {
        const { sessionId, resourceId } = decodeResourceTarget(rawSessionId, rawResourceId)
        const request = beginSessionResourceContentRequest(event.sender, sessionId)
        if (!request.isCurrent()) return null
        const remote = yield* Effect.tryPromise(() =>
          readHostSessionResourceThumbnail(sessionId, resourceId),
        )
        const thumbnail = remote.handled
          ? remote.thumbnail
          : yield* readSessionResourceThumbnail(sessionId, resourceId)
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
        const content = yield* readAvailableImageContent(sessionId, resourceId)
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
    (event, rawSessionId: unknown, rawResourceId: unknown, rawPreferredFileName?: unknown) =>
      Effect.gen(function* () {
        const { sessionId, resourceId } = decodeResourceTarget(rawSessionId, rawResourceId)
        const request = beginSessionResourceContentRequest(event.sender, sessionId)
        if (!request.isCurrent()) return yield* Effect.fail(inactiveSessionResourceError())
        const content = yield* readAvailableImageContent(sessionId, resourceId)
        if (!content) {
          return yield* Effect.fail(
            new Error('The requested Session image has no managed attachment copy.'),
          )
        }
        if (!request.isCurrent()) return yield* Effect.fail(inactiveSessionResourceError())
        const prepared = yield* Effect.promise(() =>
          prepareRegisteredImageAttachmentFromBytes({
            bytes: content.bytes,
            fileName: preferredSessionResourceFileName(rawPreferredFileName) ?? content.fileName,
            mimeType: content.mimeType,
          }),
        )
        if (request.isCurrent()) return prepared
        yield* Effect.promise(() => discardRegisteredImageAttachment(prepared))
        return yield* Effect.fail(inactiveSessionResourceError())
      }),
  )
}
