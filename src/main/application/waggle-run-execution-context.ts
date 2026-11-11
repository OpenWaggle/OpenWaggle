import type { AgentKernelRunInput } from '../ports/agent-kernel-service'

export type WaggleExecutionContext = Pick<
  AgentKernelRunInput,
  | 'runAuthorizationOverride'
  | 'authorityCallerId'
  | 'agentInstructions'
  | 'sessionIdentityContext'
  | 'runIdentityContext'
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

const WAGGLE_EXECUTION_CONTEXT_KEYS = [
  'runAuthorizationOverride',
  'authorityCallerId',
  'agentInstructions',
  'sessionIdentityContext',
  'runIdentityContext',
  'peerAgentReports',
  'onPeerAgentReportsDelivered',
  'orchestrationUpdates',
  'onOrchestrationUpdatesDelivered',
  'delegationSpecificationUpdates',
  'onDelegationSpecificationUpdatesDelivered',
  'toolAllowlist',
  'skillAllowlist',
  'mcpServerAllowlist',
  'sessionCapabilities',
  'modelMultiAgentEnabled',
] as const satisfies readonly (keyof WaggleExecutionContext)[]

type WaggleExecutionContextDraft = {
  -readonly [Key in keyof WaggleExecutionContext]?: WaggleExecutionContext[Key]
}

function copyDefined<Key extends keyof WaggleExecutionContext>(
  context: WaggleExecutionContextDraft,
  input: Partial<Pick<WaggleExecutionContext, Key>>,
  key: Key,
) {
  const value = input[key]
  if (value !== undefined) context[key] = value
}

/** Preserve one common optional execution context across classic and Waggle dispatch. */
export function toWaggleKernelExecutionContext(
  input: Partial<WaggleExecutionContext>,
): Partial<WaggleExecutionContext> {
  const context: WaggleExecutionContextDraft = {}
  for (const key of WAGGLE_EXECUTION_CONTEXT_KEYS) copyDefined(context, input, key)
  return context
}
