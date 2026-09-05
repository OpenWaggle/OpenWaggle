import type {
  AgentLoopInteraction,
  AgentLoopInteractionResponse,
} from '@shared/types/agent-loop-interaction'
import { api } from '@/shared/lib/ipc'

export async function respondAgentInteraction(
  interaction: AgentLoopInteraction,
  response: AgentLoopInteractionResponse,
) {
  const result = await api.respondAgentInteraction({
    sessionId: interaction.sessionId,
    runId: interaction.runId,
    interactionId: interaction.interactionId,
    kind: interaction.kind,
    response,
  })
  if (!result.ok) throw new Error(result.error.message)
}
