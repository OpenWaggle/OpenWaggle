import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { cleanupSessionRun } from '../agent/session-cleanup'
import {
  getAllActiveRunSessionIds,
  hasAnyActiveRun,
  requestSessionRunCancellation,
} from './active-agent-runs'
import { typedHandle } from './typed-ipc'

function requestCancellation(sessionId: SessionId) {
  if (!hasAnyActiveRun(sessionId)) return
  requestSessionRunCancellation(sessionId)
  cleanupSessionRun(sessionId)
}

export function registerAgentCancelHandler() {
  typedHandle('agent:cancel', (_event, sessionId?: SessionId) =>
    Effect.sync(() => {
      if (sessionId) {
        requestCancellation(sessionId)
        return
      }
      for (const id of getAllActiveRunSessionIds()) requestCancellation(id)
    }),
  )
}
