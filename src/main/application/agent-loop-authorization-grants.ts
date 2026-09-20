import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { SessionId } from '@shared/types/brand'
import {
  listPendingAgentLoopInteractions,
  submitAgentLoopInteractionResponse,
} from './agent-loop-interaction-broker'

export function grantPendingAuthorizationsForSession(input: {
  readonly sessionId: SessionId
}): number {
  let granted = 0
  const pending = listPendingAgentLoopInteractions(input.sessionId)
  for (const interaction of pending) {
    if (interaction.kind !== 'confirm' || interaction.purpose !== 'authorization') continue
    const result = submitAgentLoopInteractionResponse(
      {
        sessionId: interaction.sessionId,
        runId: interaction.runId,
        interactionId: interaction.interactionId,
        kind: 'confirm',
        response: { kind: 'confirm', accepted: true },
      },
      'approval',
    )
    if (result.ok) granted += 1
  }
  return granted
}

export async function grantPendingAuthorizationsWhereFullAccess(
  resolveMode: (sessionId: SessionId) => Promise<AgentAuthorizationMode>,
): Promise<number> {
  const sessionIds = new Set<SessionId>()
  for (const interaction of listPendingAgentLoopInteractions()) {
    if (interaction.kind !== 'confirm' || interaction.purpose !== 'authorization') continue
    sessionIds.add(interaction.sessionId)
  }
  const modes = await Promise.all(
    [...sessionIds].map(async (sessionId) => ({ mode: await resolveMode(sessionId), sessionId })),
  )
  let granted = 0
  for (const { mode, sessionId } of modes) {
    if (mode !== 'yolo') continue
    granted += grantPendingAuthorizationsForSession({ sessionId })
  }
  return granted
}
