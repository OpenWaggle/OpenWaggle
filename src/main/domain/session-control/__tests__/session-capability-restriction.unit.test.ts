import {
  DEFAULT_SESSION_AGENT_CAPABILITIES,
  SESSION_CAPABILITIES,
} from '@shared/types/session-capability'
import { describe, expect, it } from 'vitest'
import {
  callerSessionCapabilityRestriction,
  DEFAULT_BEFORE_SCHEDULED_TASKS,
} from '../session-capability-restriction'

describe('what a Session keeps of the capabilities of the caller that created it', () => {
  it('keeps no restriction when the caller holds the whole default grant, or is the person', () => {
    expect(callerSessionCapabilityRestriction(DEFAULT_SESSION_AGENT_CAPABILITIES)).toBeUndefined()
    expect(callerSessionCapabilityRestriction(SESSION_CAPABILITIES)).toBeUndefined()
    expect(callerSessionCapabilityRestriction(undefined)).toBeUndefined()
  })

  it('keeps the default grant narrowed to a narrower caller', () => {
    expect(callerSessionCapabilityRestriction(DEFAULT_BEFORE_SCHEDULED_TASKS)).toEqual(
      DEFAULT_BEFORE_SCHEDULED_TASKS,
    )
    expect(
      callerSessionCapabilityRestriction(['sessions:report', 'sessions:approve', 'sessions:read']),
    ).toEqual(['sessions:read', 'sessions:report'])
    expect(callerSessionCapabilityRestriction([])).toEqual([])
  })

  it('names the default grant before Scheduled tasks: today’s, without the schedule capabilities', () => {
    expect(DEFAULT_BEFORE_SCHEDULED_TASKS).toEqual(
      DEFAULT_SESSION_AGENT_CAPABILITIES.filter(
        (capability) => capability !== 'schedules:read' && capability !== 'schedules:manage',
      ),
    )
  })
})
