import type { AgentKernelRunInput } from '../ports/agent-kernel-service'

export type WaggleExecutionContext = Pick<
  AgentKernelRunInput,
  | 'runAuthorizationOverride'
  | 'authorityCallerId'
  | 'agentInstructions'
  | 'sessionIdentityContext'
  | 'peerAgentReports'
  | 'onPeerAgentReportsDelivered'
  | 'orchestrationUpdates'
  | 'onOrchestrationUpdatesDelivered'
  | 'delegationSpecificationUpdates'
  | 'onDelegationSpecificationUpdatesDelivered'
  | 'toolAllowlist'
  | 'skillAllowlist'
  | 'mcpServerAllowlist'
  | 'sessionCapabilities'
  | 'modelMultiAgentEnabled'
>

/** Preserve one common optional execution context across classic and Waggle dispatch. */
export function toWaggleKernelExecutionContext(
  input: Partial<WaggleExecutionContext>,
): Partial<WaggleExecutionContext> {
  return {
    runAuthorizationOverride: input.runAuthorizationOverride,
    authorityCallerId: input.authorityCallerId,
    agentInstructions: input.agentInstructions,
    sessionIdentityContext: input.sessionIdentityContext,
    peerAgentReports: input.peerAgentReports,
    onPeerAgentReportsDelivered: input.onPeerAgentReportsDelivered,
    orchestrationUpdates: input.orchestrationUpdates,
    onOrchestrationUpdatesDelivered: input.onOrchestrationUpdatesDelivered,
    delegationSpecificationUpdates: input.delegationSpecificationUpdates,
    onDelegationSpecificationUpdatesDelivered: input.onDelegationSpecificationUpdatesDelivered,
    toolAllowlist: input.toolAllowlist,
    skillAllowlist: input.skillAllowlist,
    mcpServerAllowlist: input.mcpServerAllowlist,
    sessionCapabilities: input.sessionCapabilities,
    modelMultiAgentEnabled: input.modelMultiAgentEnabled,
  }
}
