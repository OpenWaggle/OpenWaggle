import { describe, expect, it } from 'vitest'
import {
  canChangeSessionSettings,
  refuseRunStartSettings,
  withRunStartSettings,
} from '../run-start-settings'

describe('Session settings placement', () => {
  it('lets Session settings change only while no Run is starting, active, or stopping', () => {
    expect(canChangeSessionSettings({ state: 'idle' })).toBe(true)
    expect(canChangeSessionSettings({ state: 'starting' })).toBe(false)
    expect(canChangeSessionSettings({ state: 'active' })).toBe(false)
    expect(canChangeSessionSettings({ state: 'stopping' })).toBe(false)
  })

  it('names the refusal for settings sent with a command that does not start a Run', () => {
    expect(refuseRunStartSettings(undefined)).toBeUndefined()
    expect(refuseRunStartSettings({})).toBeUndefined()
    expect(refuseRunStartSettings({ thinkingLevel: 'low' })).toBe(
      'thinking_level_requires_idle_session',
    )
    expect(refuseRunStartSettings({ runAuthorizationOverride: 'ask-for-approval' })).toBe(
      'run_authorization_override_requires_idle_session',
    )
  })

  it('adds only the settings a starting Run was given to its intent', () => {
    const intent = { text: 'Go.', attachmentIds: [] }
    expect(withRunStartSettings(intent, undefined)).toEqual(intent)
    expect(withRunStartSettings(intent, { thinkingLevel: 'max' })).toEqual({
      ...intent,
      thinkingLevel: 'max',
    })
  })
})
