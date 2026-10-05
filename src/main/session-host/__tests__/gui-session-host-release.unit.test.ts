import { describe, expect, it, vi } from 'vitest'
import { SESSION_HOST_DRAIN_DEADLINE_SETTLE_MS } from '../../application/session-host-liveness'
import {
  releaseSessionHostForUpdate,
  SESSION_HOST_EXIT_BUDGET_MS,
  SESSION_HOST_UPDATE_RELEASE_TIMEOUT_MS,
  type SessionHostReleaseDependencies,
} from '../gui-session-host-release'
import { DESKTOP_UPDATE_HOST_STOP_DEADLINE_MS } from '../local-host-command'

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
    requestStop: async () => ({ hostInstanceId: 'host-1', processId: 4242 }),
    probe: async () => ({ state: 'not-running' }),
    processExists: () => false,
    platform: 'darwin',
    ...fakeClock(),
    ...overrides,
  }
}

describe('releasing the Session Host for an update', () => {
  it('waits for the Host process itself, which outlives its closed socket', async () => {
    const requestStop = vi.fn(async () => ({ hostInstanceId: 'host-1', processId: 4242 }))
    const processExists = vi
      .fn<(processId: number) => boolean>()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValue(false)
    // The socket is already gone; ShipIt still counts the process until it exits.
    const probe = vi.fn<SessionHostReleaseDependencies['probe']>(async () => ({
      state: 'not-running',
    }))

    await expect(
      releaseSessionHostForUpdate(client, {}, dependencies({ requestStop, processExists, probe })),
    ).resolves.toBe('stopped')
    expect(requestStop).toHaveBeenCalledOnce()
    expect(processExists).toHaveBeenCalledTimes(3)
    expect(processExists).toHaveBeenCalledWith(4242)
    // The closed socket alone never counted as stopped; one probe after the exit names a replacement.
    expect(probe).toHaveBeenCalledOnce()
  })

  it('waits longer than the Host can take to drain, settle and exit', () => {
    expect(SESSION_HOST_UPDATE_RELEASE_TIMEOUT_MS).toBe(
      DESKTOP_UPDATE_HOST_STOP_DEADLINE_MS +
        SESSION_HOST_DRAIN_DEADLINE_SETTLE_MS +
        SESSION_HOST_EXIT_BUDGET_MS,
    )
  })

  it('names a replacement Host that started from the old bundle after the process exited', async () => {
    await expect(
      releaseSessionHostForUpdate(
        client,
        {},
        dependencies({
          processExists: () => false,
          probe: async () => ({ state: 'running', hostInstanceId: 'host-2' }),
        }),
      ),
    ).resolves.toBe('replaced')
  })

  it('falls back to the endpoint when the Host does not report its process', async () => {
    const probe = vi
      .fn<SessionHostReleaseDependencies['probe']>()
      .mockResolvedValueOnce({ state: 'running', hostInstanceId: 'host-1' })
      .mockRejectedValueOnce(Object.assign(new Error('refused while closing'), { code: 'EPERM' }))
      .mockResolvedValueOnce({ state: 'not-running' })

    await expect(
      releaseSessionHostForUpdate(
        client,
        {},
        dependencies({ requestStop: async () => ({ hostInstanceId: 'host-1' }), probe }),
      ),
    ).resolves.toBe('stopped')
    expect(probe).toHaveBeenCalledTimes(3)
  })

  it('has nothing to wait for when no Host is running', async () => {
    const processExists = vi.fn<(processId: number) => boolean>()

    await expect(
      releaseSessionHostForUpdate(
        client,
        {},
        dependencies({
          requestStop: async () => {
            throw Object.assign(new Error('no socket'), { code: 'ENOENT' })
          },
          processExists,
        }),
      ),
    ).resolves.toBe('not-running')
    expect(processExists).not.toHaveBeenCalled()
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
        dependencies({ ...clock, processExists: () => true }),
      ),
    ).resolves.toBe('timed-out')
    expect(clock.now()).toBeGreaterThanOrEqual(1_000)
  })

  it('reports a Host that another client already started in its place', async () => {
    await expect(
      releaseSessionHostForUpdate(
        client,
        {},
        dependencies({
          requestStop: async () => ({ hostInstanceId: 'host-1' }),
          probe: async () => ({ state: 'running', hostInstanceId: 'host-2' }),
        }),
      ),
    ).resolves.toBe('replaced')
  })

  it.each(['win32', 'linux'] as const)(
    'only requests the stop on %s, where the installer replaces the app itself',
    async (platform) => {
      const requestStop = vi.fn(async () => ({ hostInstanceId: 'host-1', processId: 4242 }))
      const processExists = vi.fn(() => true)

      await expect(
        releaseSessionHostForUpdate(
          client,
          {},
          dependencies({ platform, requestStop, processExists }),
        ),
      ).resolves.toBe('stop-requested')
      expect(requestStop).toHaveBeenCalledOnce()
      expect(processExists).not.toHaveBeenCalled()
    },
  )
})
