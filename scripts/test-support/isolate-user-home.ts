/**
 * Shared Vitest setup: every unit, integration, and component test file runs with a temporary
 * HOME, Pi agent directory, and OpenWaggle user-data directory, no Pi session directory override,
 * and no inherited Host temp directory, and fails fast if any of them
 * resolves to the real user's home. Code that reads or writes `~/.openwaggle`, `~/.pi/agent`, or
 * Electron user data (MCP migration, Pi settings and credential migrations, Pi session discovery,
 * the cache-warming settings fallback) then only ever sees these directories.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach } from 'vitest'
import { assertTestUserLocationsIsolated, type TestUserLocations } from './user-home-guard'

const realHome = os.userInfo().homedir
const temporaryRoot = realpathSync(os.tmpdir())
const root = mkdtempSync(path.join(temporaryRoot, 'ow-test-user-'))
const home = path.join(root, 'home')
mkdirSync(home, { recursive: true })

const environment = process.env
environment.HOME = home
environment.USERPROFILE = home
environment.PI_CODING_AGENT_DIR = path.join(home, '.pi', 'agent')
environment.OPENWAGGLE_USER_DATA_DIR = path.join(root, 'user-data')
// A developer's exported Pi session dir would receive every session file a test writes; unset,
// Pi keeps them under the temporary agent dir above.
delete environment.PI_CODING_AGENT_SESSION_DIR
// Set in an agent shell; tests that read the temp directory must see this process's own.
delete environment.OPENWAGGLE_HOST_TMPDIR

function currentLocations(): TestUserLocations {
  const currentHome = os.homedir()
  return {
    home: currentHome,
    piAgentDir: environment.PI_CODING_AGENT_DIR ?? path.join(currentHome, '.pi', 'agent'),
    userDataDir: environment.OPENWAGGLE_USER_DATA_DIR,
    piSessionDir: environment.PI_CODING_AGENT_SESSION_DIR,
  }
}

/** Throws when HOME, the Pi agent or session dir, or user data now resolves to the real user's home. */
export function assertTestUserIsolated() {
  assertTestUserLocationsIsolated(currentLocations(), realHome, temporaryRoot)
}

assertTestUserIsolated()

// A test that pointed HOME back at the real home would write the user's files.
beforeEach(assertTestUserIsolated)

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})
