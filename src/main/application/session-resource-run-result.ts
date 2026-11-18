import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { captureSuccessfulRunResources } from './session-resource-capture'
import type { AcceptedAgentSteer } from './session-resource-capture-run'
import type { PersistedRunResourceNodes } from './session-resource-node-mapping'

export function captureRunResultResources(
  sessionId: SessionId,
  runId: string,
  payload: AgentSendPayload,
  result: Partial<PersistedRunResourceNodes> & { readonly outcome: string },
  acceptedSteers: readonly AcceptedAgentSteer[] = [],
) {
  if (result.resourceMessages === undefined) return Effect.void
  return captureSuccessfulRunResources({
    sessionId,
    runId,
    payload,
    messages: result.resourceMessages,
    nodeIdByMessageId: result.resourceNodeIds ?? {},
    branchIdByMessageId: result.resourceBranchIds ?? {},
    ...(acceptedSteers.length > 0 ? { acceptedSteers: [...acceptedSteers] } : {}),
  }).pipe(Effect.catchAll(() => Effect.void))
}
