import { SessionId } from '@shared/types/brand'
import type { SessionDelegationState } from '@shared/types/session'
import type { OpenWaggleServerTaskServices } from './openwaggle-mcp-task-runtime'
import type { ServerTaskRecord, ServerTaskStatus } from './openwaggle-mcp-task-store'

export async function establishTaskLineage(
  services: OpenWaggleServerTaskServices,
  task: ServerTaskRecord,
  sessionId: SessionId,
) {
  if (!task.parentSessionId) return
  await services.establishLineage({
    sessionId,
    parentSessionId: SessionId(task.parentSessionId),
    agentDefinitionName: task.callerProfile,
    delegationState: 'working',
  })
}

export async function projectTaskDelegationState(
  services: OpenWaggleServerTaskServices,
  sessionId: SessionId,
  state: SessionDelegationState,
) {
  return services
    .setDelegationState(sessionId, state)
    .then(() => true)
    .catch(() => false)
}

export function terminalDelegationState(status: ServerTaskStatus): SessionDelegationState {
  if (status === 'completed') return 'accepted'
  if (status === 'cancelled') return 'cancelled'
  return 'needs_attention'
}
