import { decodeUnknownOrThrow } from '@shared/schema'
import {
  recordSessionChangeRequestInputSchema,
  sessionResourceIdSchema,
  sessionResourceSessionIdSchema,
} from '@shared/schemas/session-resource'
import { SessionId } from '@shared/types/brand'
import type { SessionResourceContent } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { captureProjectedSessionResources } from '../application/session-resource-backfill'
import { recordSessionChangeRequest } from '../application/session-resource-recording'
import { SessionRepository } from '../ports/session-repository'
import { SessionResourceImageFetcher } from '../ports/session-resource-image-fetcher'
import { SessionResourceRepository } from '../ports/session-resource-repository'
import { SessionResourceStore } from '../ports/session-resource-store'
import { typedHandle } from './typed-ipc'

export function registerSessionResourceHandlers(): void {
  typedHandle('sessions:resources:list', (_event, rawSessionId: unknown) =>
    Effect.gen(function* () {
      const sessionId = SessionId(
        decodeUnknownOrThrow(sessionResourceSessionIdSchema, rawSessionId),
      )
      const repository = yield* SessionResourceRepository
      const sessions = yield* SessionRepository
      const tree = yield* sessions.getTree(sessionId)
      if (tree) {
        yield* captureProjectedSessionResources({
          sessionId,
          nodes: tree.nodes,
        }).pipe(Effect.catchAll(() => Effect.void))
      }
      return [...(yield* repository.list(sessionId))]
    }),
  )

  typedHandle('sessions:resources:read', (_event, rawSessionId: unknown, rawResourceId: unknown) =>
    Effect.gen(function* () {
      const sessionId = SessionId(
        decodeUnknownOrThrow(sessionResourceSessionIdSchema, rawSessionId),
      )
      const resourceId = decodeUnknownOrThrow(sessionResourceIdSchema, rawResourceId)
      const repository = yield* SessionResourceRepository
      const location = yield* repository.getContentLocation(sessionId, resourceId)
      if (location) {
        const store = yield* SessionResourceStore
        const content = yield* store.read(location.managedPath).pipe(
          Effect.map(
            (bytes) =>
              ({
                resourceId: location.resourceId,
                fileName: location.fileName,
                mimeType: location.mimeType,
                dataBase64: Buffer.from(bytes).toString('base64'),
              }) satisfies SessionResourceContent,
          ),
          Effect.catchAll(() => Effect.succeed(null)),
        )
        if (content) return content
      }
      const resource = (yield* repository.list(sessionId)).find((item) => item.id === resourceId)
      if (resource?.kind !== 'image') return null
      const remoteUrl = resource.locator?.startsWith('https://')
        ? resource.locator
        : resource.canonicalKey.startsWith('url:https://')
          ? resource.canonicalKey.slice('url:'.length)
          : null
      if (!remoteUrl) return null
      const fetched = yield* (yield* SessionResourceImageFetcher).fetch(remoteUrl)
      return {
        resourceId,
        fileName: fetched.fileName,
        mimeType: fetched.mimeType,
        dataBase64: Buffer.from(fetched.bytes).toString('base64'),
      } satisfies SessionResourceContent
    }),
  )

  typedHandle(
    'sessions:resources:record-change-request',
    (_event, rawSessionId: unknown, rawInput) =>
      recordSessionChangeRequest(
        SessionId(decodeUnknownOrThrow(sessionResourceSessionIdSchema, rawSessionId)),
        decodeUnknownOrThrow(recordSessionChangeRequestInputSchema, rawInput),
      ),
  )
}
