import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'

export function clampRunAuthorizationOverride(
  requested: AgentAuthorizationMode | undefined,
  callerCeiling: AgentAuthorizationMode | undefined,
) {
  return callerCeiling === 'ask-for-approval' ? 'ask-for-approval' : requested
}
