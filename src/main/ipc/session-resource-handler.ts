import { decodeUnknownOrThrow } from '@shared/schema'
import {
  recordSessionChangeRequestInputSchema,
  sessionResourceIdSchema,
  sessionResourceSessionIdSchema,
} from '@shared/schemas/session-resource'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { captureProjectedSessionResources } from '../application/session-resource-backfill'
import { readSessionResourceContent } from '../application/session-resource-content'
import { recordSessionChangeRequest } from '../application/session-resource-recording'
import { SessionRepository } from '../ports/session-repository'
import { SessionResourceRepository } from '../ports/session-resource-repository'
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
      return yield* readSessionResourceContent(sessionId, resourceId)
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
