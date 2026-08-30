import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import { getAgentContextUsage } from './agent-session-service'

const requiredString = Schema.String.pipe(Schema.minLength(1))

export function getHostUiAgentContextUsage(rawSessionId: unknown, rawModel: unknown) {
  const sessionId = SessionId(decodeUnknownOrThrow(requiredString, rawSessionId))
  const model = SupportedModelId(decodeUnknownOrThrow(requiredString, rawModel))
  return getAgentContextUsage({ sessionId, model })
}
