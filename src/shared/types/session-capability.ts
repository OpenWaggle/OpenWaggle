export const SESSION_CAPABILITIES = [
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
  'sessions:respond',
  'sessions:approve',
  'sessions:authorization',
  'sessions:organize',
  'sessions:export',
  'delegations:read',
  'delegations:contribute',
  'delegations:review',
  'access:profiles',
] as const

export type SessionCapability = (typeof SESSION_CAPABILITIES)[number]

/**
 * Authority a root Session agent receives by default. Interaction responses and authorization
 * changes are deliberately excluded: owning the Run being questioned must never authorize an
 * agent to answer or approve its own request.
 */
export const DEFAULT_SESSION_AGENT_CAPABILITIES = SESSION_CAPABILITIES.filter(
  (capability) =>
    capability !== 'sessions:respond' &&
    capability !== 'sessions:approve' &&
    capability !== 'sessions:authorization',
)
