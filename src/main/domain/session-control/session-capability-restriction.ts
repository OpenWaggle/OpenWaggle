import {
  DEFAULT_SESSION_AGENT_CAPABILITIES,
  SESSION_CAPABILITIES,
  type SessionCapability,
} from '@shared/types/session-capability'

/**
 * The default agent grant before Scheduled tasks (#335, 1.0.0-beta.23) added `schedules:read` and
 * `schedules:manage`. Every top-level Session created earlier persisted exactly this list as its
 * execution profile's `sessionCapabilities`, and every Session an agent of such a Session created
 * inherited it. Read as a restriction, it hid every schedule action from those agents.
 */
const DEFAULT_BEFORE_SCHEDULED_TASKS = [
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

const ADDED_WITH_SCHEDULED_TASKS = [
  'schedules:read',
  'schedules:manage',
] as const satisfies readonly SessionCapability[]

function holdsEvery(held: ReadonlySet<SessionCapability>, wanted: readonly SessionCapability[]) {
  return wanted.every((capability) => held.has(capability))
}

/**
 * A persisted Session grant as it reads today. A list holding the whole default grant of its time
 * restricted nothing when it was written, so the capabilities added to that default since are
 * added to it. Any narrower list keeps exactly what it names.
 */
export function currentSessionCapabilityRestriction(
  persisted: readonly SessionCapability[],
): readonly SessionCapability[] {
  const held = new Set(persisted)
  if (!holdsEvery(held, DEFAULT_BEFORE_SCHEDULED_TASKS)) return persisted
  const upgraded = new Set<SessionCapability>([...persisted, ...ADDED_WITH_SCHEDULED_TASKS])
  return SESSION_CAPABILITIES.filter((capability) => upgraded.has(capability))
}

/**
 * The restriction to persist for a new Session: none when it holds the whole default agent grant,
 * so a capability added to that default later reaches it as it reaches every new Session.
 */
export function sessionCapabilityRestrictionToPersist(
  capabilities: readonly SessionCapability[] | undefined,
): readonly SessionCapability[] | undefined {
  if (!capabilities) return undefined
  return holdsEvery(new Set(capabilities), DEFAULT_SESSION_AGENT_CAPABILITIES)
    ? undefined
    : capabilities
}
