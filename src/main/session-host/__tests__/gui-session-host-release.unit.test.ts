import { describe, expect, it, vi } from 'vitest'
import {
  releaseSessionHostForUpdate,
  type SessionHostReleaseDependencies,
} from '../gui-session-host-release'

const client = {
  paths: {
    stateRoot: '/tmp/openwaggle-test',
    legacyDatabasePath: '/tmp/openwaggle-test/legacy.sqlite',
    databasePath: '/tmp/openwaggle-test/session-host.sqlite',
    recoveryDatabasePath: '/tmp/openwaggle-test/recovery.sqlite',
    credentialPath: '/tmp/openwaggle-test/local-user.credential',
    endpoint: '/tmp/openwaggle-test/host.sock',
    endpointDirectory: '/tmp/openwaggle-test',
    endpointCapabilityPath: null,
  },
  clientVersion: 'test',
}

function fakeClock() {
  let now = 0
  return {
    now: () => now,
    wait: vi.fn(async (milliseconds: number) => {
      now += milliseconds
    }),
  }
}

function dependencies(
  overrides: Partial<SessionHostReleaseDependencies>,
): SessionHostReleaseDependencies {
  return {
    requestStop: async () => 'host-1',
    probe: async () => ({ state: 'not-running' }),
    ...fakeClock(),
    ...overrides,
  }
}

describe('releasing the Session Host for an update', () => {
  it('asks the Host to stop and waits until its process is gone', async () => {
    const requestStop = vi.fn(async () => 'host-1')
    const probe = vi
      .fn<SessionHostReleaseDependencies['probe']>()
      .mockResolvedValueOnce({ state: 'running', hostInstanceId: 'host-1' })
      .mockRejectedValueOnce(Object.assign(new Error('refused while closing'), { code: 'EPERM' }))
      .mockResolvedValueOnce({ state: 'not-running' })

    await expect(
      releaseSessionHostForUpdate(client, {}, dependencies({ requestStop, probe })),
    ).resolves.toBe('stopped')
    expect(requestStop).toHaveBeenCalledOnce()
    expect(probe).toHaveBeenCalledTimes(3)
  })

  it('has nothing to wait for when no Host is running', async () => {
    const probe = vi.fn<SessionHostReleaseDependencies['probe']>()

    await expect(
      releaseSessionHostForUpdate(
        client,
        {},
        dependencies({
          requestStop: async () => {
            throw Object.assign(new Error('no socket'), { code: 'ENOENT' })
          },
          probe,
        }),
      ),
    ).resolves.toBe('not-running')
    expect(probe).not.toHaveBeenCalled()
  })

  it('lets the app quit when an older Host refuses the stop', async () => {
    await expect(
      releaseSessionHostForUpdate(
        client,
        {},
        dependencies({
          requestStop: async () => {
            throw Object.assign(new Error('capability denied'), { code: 'capability_denied' })
          },
        }),
      ),
    ).resolves.toBe('refused')
  })

  it('stops waiting at its timeout so a stuck Host never keeps the app open', async () => {
    const clock = fakeClock()

    await expect(
      releaseSessionHostForUpdate(
        client,
        { timeoutMs: 1_000 },
        dependencies({
          ...clock,
          probe: async () => ({ state: 'running', hostInstanceId: 'host-1' }),
        }),
      ),
    ).resolves.toBe('timed-out')
    expect(clock.now()).toBeGreaterThanOrEqual(1_000)
  })

  it('reports a Host that another client already started in its place', async () => {
    await expect(
      releaseSessionHostForUpdate(
        client,
        {},
        dependencies({ probe: async () => ({ state: 'running', hostInstanceId: 'host-2' }) }),
      ),
    ).resolves.toBe('replaced')
  })
})
