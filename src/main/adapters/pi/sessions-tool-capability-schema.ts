import type { SessionCapability } from '@shared/types/session-capability'
import type { TSchema } from 'typebox'
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
  ['items', ['sessions:read']],
  ['export', ['sessions:export', 'sessions:read']],
  ['export_create', ['sessions:export', 'sessions:read']],
  ['export_cancel', ['sessions:export']],
  ['exports_list', ['sessions:export', 'sessions:read']],
  ['exports_read', ['sessions:export', 'sessions:read']],
  ['exports_wait', ['sessions:export', 'sessions:read']],
  ['wait', ['sessions:read']],
  ['schedule_list', ['schedules:read']],
  ['schedule_read', ['schedules:read']],
  ['schedule_runs', ['schedules:read']],
  ['schedule_create', ['schedules:manage']],
  ['schedule_update', ['schedules:manage']],
  ['schedule_delete', ['schedules:manage']],
  ['schedule_run_now', ['schedules:manage']],
])

function variantActionName(variant: SessionsToolRuntimeVariant): string | undefined {
  return actionChoices(variant.properties.action)[0]?.const
}

const KNOWN_ACTIONS: ReadonlySet<string> = new Set(
  sessionsToolParameterVariants.flatMap((variant) => variantActionName(variant) ?? []),
)

export interface SessionsToolActionGrant {
  /** The Session's derived grant; undefined for a Session that has none (all actions). */
  readonly capabilities: readonly SessionCapability[] | undefined
  readonly modelMultiAgentEnabled: boolean
}

export type SessionsToolActionPermission =
  | { readonly permitted: true }
  | { readonly permitted: false; readonly reason: 'unknown-action' }
  | { readonly permitted: false; readonly reason: 'multi-agent-disabled' }
  | {
      readonly permitted: false
      readonly reason: 'capability-denied'
      readonly required: readonly SessionCapability[]
      readonly missing: readonly SessionCapability[]
    }

/** Whether this Session's grant can use a hive action, and if not, why. */
export function sessionsToolActionPermission(
  action: string,
  grant: SessionsToolActionGrant,
): SessionsToolActionPermission {
  if (!KNOWN_ACTIONS.has(action)) return { permitted: false, reason: 'unknown-action' }
  if (grant.capabilities === undefined) return { permitted: true }
  if ((action === 'launch' || action === 'spawn') && !grant.modelMultiAgentEnabled) {
    return { permitted: false, reason: 'multi-agent-disabled' }
  }
  const required = REQUIRED_CAPABILITIES.get(action) ?? []
  const available = new Set(grant.capabilities)
  const missing = required.filter((capability) => !available.has(capability))
  return missing.length === 0
    ? { permitted: true }
    : { permitted: false, reason: 'capability-denied', required, missing }
}

export function permitsSessionsToolAction(action: string, grant: SessionsToolActionGrant) {
  return sessionsToolActionPermission(action, grant).permitted
}

function joinCapabilities(capabilities: readonly string[], conjunction: 'and' | 'or') {
  if (capabilities.length <= 1) return capabilities.join('')
  return `${capabilities.slice(0, -1).join(', ')} ${conjunction} ${capabilities.at(-1)}`
}

/**
 * The schema offers only permitted actions, so a call to another one would fail validation with
 * a constant mismatch per action. Name what is missing instead, before validation runs.
 */
export function assertSessionsToolActionPermitted(
  args: unknown,
  grant: SessionsToolActionGrant,
): void {
  if (typeof args !== 'object' || args === null || !('action' in args)) return
  const action: unknown = args.action
  if (typeof action !== 'string') return
  const permission = sessionsToolActionPermission(action, grant)
  if (permission.permitted) return
  if (permission.reason === 'unknown-action') throw new Error(`Unknown hive action "${action}".`)
  if (permission.reason === 'multi-agent-disabled') {
    throw new Error(
      `capability_denied: the hive action ${action} is not available: multi-agent work is turned off for this project or model.`,
    )
  }
  throw new Error(
    `capability_denied: the hive action ${action} requires ${joinCapabilities(permission.required, 'and')}; this Session has no ${joinCapabilities(permission.missing, 'or')}.`,
  )
}

export function sessionsToolSchemaForCapabilities(input: {
  readonly capabilities: readonly SessionCapability[]
  readonly modelMultiAgentEnabled: boolean
}) {
  const variants = sessionsToolParameterVariants.filter((variant) => {
    const action = variantActionName(variant)
    return action !== undefined && permitsSessionsToolAction(action, input)
  })
  return flattenSessionsToolParameters(variants)
}

/** The provider schema of the hive tool; a Session without a derived grant gets every action. */
export function sessionsToolSchemaForGrant(grant: SessionsToolActionGrant): TSchema {
  return grant.capabilities
    ? sessionsToolSchemaForCapabilities({
        capabilities: grant.capabilities,
        modelMultiAgentEnabled: grant.modelMultiAgentEnabled,
      })
    : flattenSessionsToolParameters(sessionsToolParameterVariants)
}
