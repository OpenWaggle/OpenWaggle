import {
  DEFAULT_SESSION_AGENT_CAPABILITIES,
  type SessionCapability,
} from '@shared/types/session-capability'
import { describe, expect, it } from 'vitest'
import {
  currentSessionCapabilityRestriction,
  sessionCapabilityRestrictionToPersist,
} from '../session-capability-restriction'

/** The default agent grant a Session persisted before Scheduled tasks existed (#335). */
const DEFAULT_BEFORE_SCHEDULED_TASKS: readonly SessionCapability[] =
  DEFAULT_SESSION_AGENT_CAPABILITIES.filter(
    (capability) => capability !== 'schedules:read' && capability !== 'schedules:manage',
  )

describe('a persisted Session capability restriction', () => {
  it('reads the whole default grant of its time as unrestricted, schedules included', () => {
    expect(currentSessionCapabilityRestriction(DEFAULT_BEFORE_SCHEDULED_TASKS)).toEqual(
      DEFAULT_SESSION_AGENT_CAPABILITIES,
    )
  })

  it('keeps a narrower list exactly as it was granted', () => {
    const narrow: readonly SessionCapability[] = ['sessions:read', 'sessions:report']
    const withoutExport = DEFAULT_BEFORE_SCHEDULED_TASKS.filter(
      (capability) => capability !== 'sessions:export',
    )

    expect(currentSessionCapabilityRestriction(narrow)).toEqual(narrow)
    expect(currentSessionCapabilityRestriction([])).toEqual([])
    expect(currentSessionCapabilityRestriction(withoutExport)).toEqual(withoutExport)
  })

  it('persists no restriction for a Session holding the whole default grant', () => {
    expect(
      sessionCapabilityRestrictionToPersist(DEFAULT_SESSION_AGENT_CAPABILITIES),
    ).toBeUndefined()
    expect(sessionCapabilityRestrictionToPersist(undefined)).toBeUndefined()
    expect(sessionCapabilityRestrictionToPersist(['sessions:read'])).toEqual(['sessions:read'])
  })
})
