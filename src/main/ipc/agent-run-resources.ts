import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import type { AgentRunResult } from '../application/agent-run/types'
import { captureSuccessfulRunResources } from '../application/session-resource-capture'

export function captureRunResultResources(
  sessionId: SessionId,
  runId: string,
  payload: AgentSendPayload,
  result: AgentRunResult,
) {
  if (result.resourceMessages === undefined) return Effect.void
  return captureSuccessfulRunResources({
    sessionId,
    runId,
    payload,
    messages: result.resourceMessages,
    nodeIdByMessageId: result.resourceNodeIds ?? {},
    branchIdByMessageId: result.resourceBranchIds ?? {},
  }).pipe(Effect.catchAll(() => Effect.void))
}
