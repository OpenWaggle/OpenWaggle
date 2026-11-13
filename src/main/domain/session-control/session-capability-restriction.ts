import {
  DEFAULT_SESSION_AGENT_CAPABILITIES,
  type SessionCapability,
} from '@shared/types/session-capability'

/**
 * The default agent grant before Scheduled tasks (#335, 1.0.0-beta.23) added `schedules:read` and
 * `schedules:manage`. Every top-level Session created earlier persisted exactly this list as its
 * execution profile's `sessionCapabilities`, and every Session an agent of such a Session created
 * inherited it. Read as a restriction, it hid every schedule action from those agents, so the Host
 * removes it once at start (`sqlite-legacy-session-capability-migration.ts`).
 */
export const DEFAULT_BEFORE_SCHEDULED_TASKS = [
  'sessions:discover',
  'sessions:read',
  'sessions:create',
  'sessions:start',
  'sessions:spawn',
  'sessions:message',
  'sessions:steer',
  'sessions:interrupt',
  'sessions:queue',
  'sessions:report',
  'sessions:organize',
  'sessions:export',
  'delegations:read',
  'delegations:contribute',
  'delegations:review',
  'access:profiles',
] as const satisfies readonly SessionCapability[]

/**
 * What a Session another caller creates keeps of that caller's capabilities: the default agent
 * grant narrowed to them, or no restriction at all when the caller holds the whole default grant,
 * so a capability added to that default later reaches the Session as it reaches every new one.
 */
export function callerSessionCapabilityRestriction(
  callerCapabilities: readonly SessionCapability[] | undefined,
): readonly SessionCapability[] | undefined {
  if (!callerCapabilities) return undefined
  const restriction = DEFAULT_SESSION_AGENT_CAPABILITIES.filter((capability) =>
    callerCapabilities.includes(capability),
  )
  return restriction.length === DEFAULT_SESSION_AGENT_CAPABILITIES.length ? undefined : restriction
}
