import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  LOCAL_SESSION_CAPABILITIES,
  LOCAL_SESSION_CURRENT_REVISION,
  LOCAL_SESSION_PROTOCOL_NAME,
} from '@shared/types/local-session-protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ensureLocalSessionHost,
  type LocalSessionHostLauncherDependencies,
} from '../local-session-host-launcher'
import { acquireSessionHostOwnership, type SessionHostOwnership } from '../session-host-ownership'

/** How long a launched Host takes before it asks for ownership: Electron's boot, in miniature. */
const HOST_BOOT_MS = 50
/** How long the Host that owns the profile takes, after that, to listen. */
const HOST_START_MS = 50

/*
 * When a Host stops, every GUI client that used it (the renderer bridge, the desktop services, the
 * command router) runs ensureLocalSessionHost at once. Each found nobody listening and the
 * ownership file free, because the Host the first one launched had not booted yet, so each launched
 * its own Host. All but one of those then failed to take ownership and stopped with ELOCKED, logged
 * as "Session Host stopped on an unrecoverable error" and reported as a crash.
 */
describe('Local Session Host launch race', () => {
  let root = ''
  const owners: SessionHostOwnership[] = []

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-launch-race-'))
  })

  afterEach(async () => {
    await Promise.all(owners.splice(0).map((owner) => owner.release()))
    await fs.rm(root, { recursive: true, force: true })
  })

  function simulatedHosts(databasePath: string) {
    const outcomes: string[] = []
    let listening = false
    const dependencies: LocalSessionHostLauncherDependencies = {
      canConnect: async () => listening,
      probe: async () => ({
        accepted: true as const,
        protocol: LOCAL_SESSION_PROTOCOL_NAME,
        revision: LOCAL_SESSION_CURRENT_REVISION,
        hostInstanceId: 'host-current',
        capabilities: LOCAL_SESSION_CAPABILITIES,
      }),
      tryAcquireOwnership: async (candidate) =>
        acquireSessionHostOwnership(candidate, { timeoutMs: 0 }).catch((error: unknown) => {
          if (error instanceof Error && 'code' in error && error.code === 'ELOCKED') return null
          throw error
        }),
      launch: () => {
        // A detached Host process: it boots, takes ownership as session-host-cli-entry does, listens.
        void delay(HOST_BOOT_MS)
          .then(() => acquireSessionHostOwnership(databasePath))
          .then(async (ownership) => {
            owners.push(ownership)
            await delay(HOST_START_MS)
            listening = true
            outcomes.push('listening')
          })
          .catch((error: unknown) => {
            outcomes.push(error instanceof Error ? error.message : String(error))
          })
      },
      now: () => performance.now(),
      wait: (milliseconds) => delay(milliseconds),
      refreshPaths: async (candidate) => candidate,
    }
    return { dependencies, outcomes }
  }

  it('launches one Host when several clients find it stopped at once', async () => {
    const databasePath = path.join(root, 'host.sqlite')
    const paths = {
      stateRoot: root,
      legacyDatabasePath: path.join(root, 'legacy.sqlite'),
      databasePath,
      recoveryDatabasePath: path.join(root, 'recovery.sqlite'),
      credentialPath: path.join(root, 'credential'),
      endpoint: path.join(root, 'host.sock'),
      endpointDirectory: root,
      endpointCapabilityPath: null,
    }
    const { dependencies, outcomes } = simulatedHosts(databasePath)
    const client = { paths, clientKind: 'gui' as const, clientVersion: 'current' }

    await Promise.all(Array.from({ length: 4 }, () => ensureLocalSessionHost(client, dependencies)))
    // Long enough for any surplus Host to give up waiting for ownership.
    await delay(1500)

    expect(outcomes).toEqual(['listening'])
  })
})
