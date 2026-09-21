import type { SessionCapability } from '@shared/types/session-capability'
import type { SessionHostEventPayload } from '@shared/types/session-host-event'

const EVENT_CAPABILITY = {
  'session-transport': 'sessions:read',
  'session-waggle-transport': 'sessions:read',
  'session-waggle-turn': 'sessions:read',
  'session-export-changed': 'sessions:export',
  'session-state-changed': 'sessions:discover',
  'session-list-changed': 'sessions:discover',
  'semantic-discovery-readiness-changed': 'sessions:discover',
} as const satisfies Record<SessionHostEventPayload['kind'], SessionCapability>

export function requiredCapabilityForSessionEvent(payload: SessionHostEventPayload) {
  return EVENT_CAPABILITY[payload.kind]
}
