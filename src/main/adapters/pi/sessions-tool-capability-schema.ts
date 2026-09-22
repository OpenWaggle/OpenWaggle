import type { SessionCapability } from '@shared/types/session-capability'
import {
  actionChoices,
  flattenSessionsToolParameters,
  type SessionsToolRuntimeVariant,
  sessionsToolParameterVariants,
} from './sessions-tool-flat-schema'

const REQUIRED_CAPABILITIES = new Map<string, readonly SessionCapability[]>([
  ['create', ['sessions:create']],
  ['fork', ['sessions:create', 'sessions:read']],
  ['launch', ['sessions:create', 'sessions:start']],
  ['spawn', ['sessions:spawn']],
  ['message', ['sessions:message']],
  ['start', ['sessions:start']],
  ['follow_up', ['sessions:message']],
  ['steer', ['sessions:steer']],
  ['replace', ['sessions:message', 'sessions:interrupt']],
  ['promote', ['sessions:queue', 'sessions:steer']],
  ['interrupt', ['sessions:interrupt']],
  ['interrupt_descendants', ['sessions:interrupt']],
  ['request_respond', ['sessions:respond']],
  ['approval_respond', ['sessions:approve']],
  ['authorization_set', ['sessions:authorization']],
  ['rename', ['sessions:organize']],
  ['archive', ['sessions:organize']],
  ['unarchive', ['sessions:organize']],
  ['handoff', ['sessions:organize']],
  ['report', ['sessions:report']],
  ['delegation_submit', ['delegations:contribute']],
  ['delegation_state', ['delegations:contribute']],
  ['delegation_claim', ['delegations:contribute']],
  ['delegation_conflict_acknowledge', ['delegations:review']],
  ['delegation_dependency', ['delegations:review']],
  ['delegation_propose_amendment', ['delegations:contribute']],
  ['delegation_amend', ['delegations:review']],
  ['delegation_request_revision', ['delegations:review']],
  ['delegation_accept', ['delegations:review']],
  ['delegation_reopen', ['delegations:review']],
  ['delegation_cancel', ['delegations:review']],
  ['delegation_verify', ['delegations:review']],
  ['delegations_list', ['delegations:read']],
  ['delegations_read', ['delegations:read']],
  ['delegations_conflicts', ['delegations:read']],
  ['list', ['sessions:discover']],
  ['search', ['sessions:discover']],
  ['read', ['sessions:read']],
  ['turns', ['sessions:read']],
  ['status', ['sessions:read']],
  ['queue_list', ['sessions:queue']],
  ['requests_list', ['sessions:read']],
  ['queue_withdraw', ['sessions:queue']],
  ['queue_reorder', ['sessions:queue']],
  ['queue_pause', ['sessions:queue']],
  ['queue_resume', ['sessions:queue']],
  ['queue_update_authorization', ['sessions:queue']],
  ['items', ['sessions:read']],
  ['export', ['sessions:export', 'sessions:read']],
  ['export_create', ['sessions:export', 'sessions:read']],
  ['export_cancel', ['sessions:export']],
  ['exports_list', ['sessions:export', 'sessions:read']],
  ['exports_read', ['sessions:export', 'sessions:read']],
  ['exports_wait', ['sessions:export', 'sessions:read']],
  ['wait', ['sessions:read']],
])

function variantActionName(variant: SessionsToolRuntimeVariant): string | undefined {
  return actionChoices(variant.properties.action)[0]?.const
}

function permitsAction(
  action: string,
  capabilities: ReadonlySet<SessionCapability>,
  modelMultiAgentEnabled: boolean,
) {
  if ((action === 'launch' || action === 'spawn') && !modelMultiAgentEnabled) return false
  const required = REQUIRED_CAPABILITIES.get(action)
  return required === undefined || required.every((capability) => capabilities.has(capability))
}

export function sessionsToolSchemaForCapabilities(input: {
  readonly capabilities: readonly SessionCapability[]
  readonly modelMultiAgentEnabled: boolean
}) {
  const capabilities = new Set(input.capabilities)
  const variants = sessionsToolParameterVariants.filter((variant) => {
    const action = variantActionName(variant)
    return action !== undefined && permitsAction(action, capabilities, input.modelMultiAgentEnabled)
  })
  return flattenSessionsToolParameters(variants)
}
