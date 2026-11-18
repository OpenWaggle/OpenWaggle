import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { listStreamBuffers } from '../utils/stream-buffer'
import { listActiveCompactions } from './active-session-runs'
import {
  listAgentExtensionCommands,
  listProjectExtensionCommands,
} from './agent-extension-commands'
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

const optionalString = Schema.NullishOr(requiredString)

/** For a Session, or with none, as for a New session draft, for its project. */
export function listHostUiAgentExtensionCommands(
  rawSessionId: unknown,
  rawModel: unknown,
  rawProjectPath?: unknown,
) {
  const sessionId = decodeUnknownOrThrow(optionalString, rawSessionId)
  const model = SupportedModelId(decodeUnknownOrThrow(requiredString, rawModel))
  if (sessionId) return listAgentExtensionCommands({ sessionId: SessionId(sessionId), model })
  const projectPath = decodeUnknownOrThrow(optionalString, rawProjectPath)
  return projectPath ? listProjectExtensionCommands({ projectPath, model }) : Effect.succeed([])
}
