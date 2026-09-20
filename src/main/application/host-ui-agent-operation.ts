import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { listStreamBuffers } from '../utils/stream-buffer'
import { listActiveCompactions } from './active-session-runs'
import { getAgentContextUsage } from './agent-session-service'

const requiredString = Schema.String.pipe(Schema.minLength(1))

export function listHostUiActiveActivities() {
  return Effect.sync(() => [...listStreamBuffers(), ...listActiveCompactions()])
}

export function getHostUiAgentContextUsage(rawSessionId: unknown, rawModel: unknown) {
  const sessionId = SessionId(decodeUnknownOrThrow(requiredString, rawSessionId))
  const model = SupportedModelId(decodeUnknownOrThrow(requiredString, rawModel))
  return getAgentContextUsage({ sessionId, model })
}
