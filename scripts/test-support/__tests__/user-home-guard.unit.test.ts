import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertTestUserIsolated } from '../isolate-user-home'
import { assertTestUserLocationsIsolated } from '../user-home-guard'

const REAL_HOME = '/Users/maintainer'
const TEMP = '/var/folders/xy/T'

function locations(overrides: Partial<Parameters<typeof assertTestUserLocationsIsolated>[0]>) {
  return {
    home: `${TEMP}/ow-test-user-1/home`,
    piAgentDir: `${TEMP}/ow-test-user-1/home/.pi/agent`,
    userDataDir: `${TEMP}/ow-test-user-1/user-data`,
    piSessionDir: undefined,
    ...overrides,
  }
}

describe('the test user-home guard', () => {
  it('accepts temporary locations', () => {
    expect(() => assertTestUserLocationsIsolated(locations({}), REAL_HOME, TEMP)).not.toThrow()
  })

  it.each([
    ['HOME is the real home', { home: REAL_HOME }],
    ['Pi agent dir is the real one', { piAgentDir: `${REAL_HOME}/.pi/agent` }],
    ['user data is in the real home', { userDataDir: `${REAL_HOME}/Library/Application Support/openwaggle` }],
    ['HOME contains the real home', { home: '/Users' }],
    ['Pi session dir is in the real home', { piSessionDir: `${REAL_HOME}/pi-sessions` }],
  ])('trips when %s', (_case, overrides) => {
    expect(() => assertTestUserLocationsIsolated(locations(overrides), REAL_HOME, TEMP)).toThrow(
      /must not use the real user's files/,
    )
  })

  it('allows a temporary directory that lives inside the real home', () => {
    const temp = `${REAL_HOME}/tmp`
    const inside = {
      home: `${temp}/h`,
      piAgentDir: `${temp}/h/.pi/agent`,
      userDataDir: `${temp}/u`,
      piSessionDir: undefined,
    }
    expect(() => assertTestUserLocationsIsolated(inside, REAL_HOME, temp)).not.toThrow()
  })

  it('is installed: this test runs with a temporary HOME, Pi agent dir, and user data', () => {
    const realHome = os.userInfo().homedir
    expect(os.homedir()).not.toBe(realHome)
    expect(path.relative(realHome, os.homedir()).startsWith('..') || os.homedir().startsWith(os.tmpdir())).toBe(true)
  })

  it("clears a developer's Pi session dir and Host temp dir, so tests use their own", () => {
    expect(process.env.PI_CODING_AGENT_SESSION_DIR).toBeUndefined()
    expect(process.env.OPENWAGGLE_HOST_TMPDIR).toBeUndefined()
  })

  it('trips in the shared setup when a test points the Pi session dir at the real home', () => {
    const environment = process.env
    environment.PI_CODING_AGENT_SESSION_DIR = path.join(os.userInfo().homedir, 'pi-sessions')
    try {
      expect(() => assertTestUserIsolated()).toThrow(/must not use the real user's files/)
    } finally {
      delete environment.PI_CODING_AGENT_SESSION_DIR
    }
  })

  it('trips in the shared setup when a test points HOME at the real home', () => {
    const environment = process.env
    const temporaryHome = environment.HOME
    environment.HOME = os.userInfo().homedir
    try {
      expect(() => assertTestUserIsolated()).toThrow(/must not use the real user's files/)
    } finally {
      environment.HOME = temporaryHome
    }
    expect(() => assertTestUserIsolated()).not.toThrow()
  })
})
