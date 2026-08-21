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

  it('falls back to the global default when neither the session nor the project overrides', () => {
    expect(
      pickAuthorizationMode({
        sessionOverride: undefined,
        projectDefault: undefined,
        globalDefault: 'ask-for-approval',
      }),
    ).toBe('ask-for-approval')
  })

  it('lets a tightened global default reach a session that was never overridden', () => {
    const before = pickAuthorizationMode({ globalDefault: 'yolo' })
    const after = pickAuthorizationMode({ globalDefault: 'ask-for-approval' })

    expect(before).toBe('yolo')
    expect(after).toBe('ask-for-approval')
  })

  it('treats an absent level as inherit rather than as yolo', () => {
    // The regression this guards: reading a missing override as 'yolo' would make every
    // unconfigured session silently full access and make the precedence chain unobservable.
    expect(
      pickAuthorizationMode({
        sessionOverride: null,
        projectDefault: null,
        globalDefault: 'ask-for-approval',
      }),
    ).not.toBe('yolo')
  })

  it('fails closed when no level can be determined', () => {
    expect(pickAuthorizationMode({})).toBe(FAIL_CLOSED_AUTHORIZATION_MODE)
    expect(pickAuthorizationMode({})).toBe('ask-for-approval')
  })
})
