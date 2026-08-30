import type { SessionId } from '@shared/types/brand'
import type { SessionResourceContent } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { captureProjectedSessionResources } from '../application/session-resource-backfill'
import { recordSessionChangeRequest } from '../application/session-resource-recording'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SessionResourceRepository } from '../ports/session-resource-repository'
import { SessionResourceStore } from '../ports/session-resource-store'
import { typedHandle } from './typed-ipc'

export function registerSessionResourceHandlers(): void {
  typedHandle('sessions:resources:list', (_event, sessionId: SessionId) =>
    Effect.gen(function* () {
      const repository = yield* SessionResourceRepository
      const sessions = yield* SessionProjectionRepository
      const session = yield* sessions.getOptional(sessionId)
      if (session) {
        yield* captureProjectedSessionResources({
          sessionId,
          messages: session.messages,
        }).pipe(Effect.catchAll(() => Effect.void))
      }
      return [...(yield* repository.list(sessionId))]
    }),
  )

  typedHandle('sessions:resources:read', (_event, sessionId: SessionId, resourceId: string) =>
    Effect.gen(function* () {
      const repository = yield* SessionResourceRepository
      const location = yield* repository.getContentLocation(sessionId, resourceId)
      if (!location) return null
      const store = yield* SessionResourceStore
      const bytes = yield* store.read(location.managedPath)
      return {
        resourceId: location.resourceId,
        fileName: location.fileName,
        mimeType: location.mimeType,
        dataBase64: Buffer.from(bytes).toString('base64'),
      } satisfies SessionResourceContent
    }),
  )

  typedHandle('sessions:resources:record-change-request', (_event, sessionId: SessionId, input) =>
    recordSessionChangeRequest(sessionId, input),
  )
}
