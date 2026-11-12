import { describe, expect, it } from 'vitest'
import { FAIL_CLOSED_AUTHORIZATION_MODE, pickAuthorizationMode } from '../agent-authorization-mode'

describe('pickAuthorizationMode', () => {
  it('prefers a session override over both defaults', () => {
    expect(
      pickAuthorizationMode({
        sessionOverride: 'ask-for-approval',
        projectDefault: 'yolo',
        globalDefault: 'yolo',
      }),
    ).toBe('ask-for-approval')
  })

  it('falls back to the project default when the session holds no override', () => {
    expect(
      pickAuthorizationMode({
        sessionOverride: null,
        projectDefault: 'ask-for-approval',
        globalDefault: 'yolo',
      }),
    ).toBe('ask-for-approval')
  })

  // An absent override is inherit, never yolo: reading it as 'yolo' would make every unconfigured
  // session silently full access, and a tightened global default must reach those sessions.
  it.each([
    { sessionOverride: undefined, projectDefault: undefined, globalDefault: 'ask-for-approval' },
    { sessionOverride: null, projectDefault: null, globalDefault: 'ask-for-approval' },
    { globalDefault: 'ask-for-approval' },
    { globalDefault: 'yolo' },
  ] as const)(
    'falls back to the global default when neither the session nor the project overrides: %j',
    (input) => {
      expect(pickAuthorizationMode(input)).toBe(input.globalDefault)
    },
  )

  it('fails closed when no level can be determined', () => {
    expect(pickAuthorizationMode({})).toBe(FAIL_CLOSED_AUTHORIZATION_MODE)
    expect(pickAuthorizationMode({})).toBe('ask-for-approval')
  })
})
