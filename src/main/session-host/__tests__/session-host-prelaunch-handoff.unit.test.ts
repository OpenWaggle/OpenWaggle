import { describe, expect, it } from 'vitest'
import {
  hasSessionHostPrelaunch,
  recordSessionHostPrelaunch,
  type SessionHostPrelaunch,
  takeSessionHostPrelaunch,
} from '../session-host-prelaunch-handoff'

function prelaunch(userDataRoot: string, ended = false): SessionHostPrelaunch {
  return { userDataRoot, ended: new Promise(() => undefined), hasEnded: () => ended }
}

describe('Session Host prelaunch hand-off', () => {
  it("hands the boot shim's Host to the GUI once, for the same profile", () => {
    const scope = {}
    const launched = prelaunch('/profiles/a')
    recordSessionHostPrelaunch(launched, scope)

    expect(hasSessionHostPrelaunch(undefined, scope)).toBe(true)
    expect(hasSessionHostPrelaunch('/profiles/a/', scope)).toBe(true)
    expect(hasSessionHostPrelaunch('/profiles/b', scope)).toBe(false)
    expect(takeSessionHostPrelaunch('/profiles/a', scope)).toBe(launched)
    expect(takeSessionHostPrelaunch('/profiles/a', scope)).toBeNull()
    expect(hasSessionHostPrelaunch(undefined, scope)).toBe(false)
  })

  it('travels on a registered symbol, which the shim and the main bundle share', () => {
    const scope = {}
    recordSessionHostPrelaunch(prelaunch('/profiles/a'), scope)

    expect(Reflect.get(scope, Symbol.for('openwaggle.session-host-prelaunch'))).toMatchObject({
      userDataRoot: '/profiles/a',
    })
  })

  it('gives no Host launched for another profile, or one that already ended', () => {
    const scope = {}
    recordSessionHostPrelaunch(prelaunch('/profiles/a'), scope)
    expect(takeSessionHostPrelaunch('/profiles/b', scope)).toBeNull()

    recordSessionHostPrelaunch(prelaunch('/profiles/a', true), scope)
    expect(takeSessionHostPrelaunch('/profiles/a', scope)).toBeNull()
    expect(takeSessionHostPrelaunch('/profiles/a', {})).toBeNull()
  })
})
