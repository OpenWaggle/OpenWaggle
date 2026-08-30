import type { SessionCapability } from '@shared/types/session-capability'
import { Type } from 'typebox'
import { sessionsToolParameters } from './sessions-tool-parameters'

const REQUIRED_CAPABILITIES = new Map<string, readonly SessionCapability[]>([
  ['create', ['sessions:create']],
  ['fork', ['sessions:create', 'sessions:read']],
  ['launch', ['sessions:create', 'sessions:start']],
  ['spawn', ['sessions:spawn']],
  ['message', ['sessions:message']],
  ['start', ['sessions:start']],
  ['follow_up', ['sessions:message']],
  ['steer', ['sessions:steer']],
  ['replace', ['sessions:interrupt', 'sessions:start']],
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
  ['exports_list', ['sessions:export']],
  ['exports_read', ['sessions:export']],
  ['exports_wait', ['sessions:export']],
  ['wait', ['sessions:read']],
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function actionName(schema: unknown): string | undefined {
  if (!isRecord(schema)) return undefined
  return typeof schema.const === 'string' ? schema.const : undefined
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

function filterAlternativeInPlace(
  schema: unknown,
  capabilities: ReadonlySet<SessionCapability>,
  modelMultiAgentEnabled: boolean,
) {
  if (!isRecord(schema) || !isRecord(schema.properties)) return false
  const action = schema.properties.action
  if (!isRecord(action)) return false
  const choices = Array.isArray(action.anyOf) ? action.anyOf : [action]
  const allowed = choices.filter((candidate) => {
    const name = actionName(candidate)
    return name !== undefined && permitsAction(name, capabilities, modelMultiAgentEnabled)
  })
  if (allowed.length === 0) return false
  if (allowed.length === choices.length) return true
  const names = allowed.flatMap((candidate) => {
    const name = actionName(candidate)
    return name ? [name] : []
  })
  schema.properties.action =
    names.length === 1
      ? Type.Literal(names[0] ?? '')
      : Type.Union(names.map((name) => Type.Literal(name)))
  return true
}

export function sessionsToolSchemaForCapabilities(input: {
  readonly capabilities: readonly SessionCapability[]
  readonly modelMultiAgentEnabled: boolean
}): typeof sessionsToolParameters {
  const capabilities = new Set(input.capabilities)
  const schema = structuredClone(sessionsToolParameters)
  const alternatives = schema.anyOf.filter((alternative) =>
    filterAlternativeInPlace(alternative, capabilities, input.modelMultiAgentEnabled),
  )
  schema.anyOf.splice(0, schema.anyOf.length, ...alternatives)
  return schema
}
