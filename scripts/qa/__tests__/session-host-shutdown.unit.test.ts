import { describe, expect, it, vi } from 'vitest'
import type { LocalSessionHostPaths } from '../../../src/main/session-host/local-session-paths'
import type { SessionHostOwnership } from '../../../src/main/session-host/session-host-ownership'
import { SESSION_HOST_EXIT_BUDGET_MS } from '../../../src/main/session-host/session-host-update-stop'
import { shutdownSessionHostForQa } from '../session-host-shutdown'

function paths(platform: NodeJS.Platform) {
  const windows = platform === 'win32'
  return {
    stateRoot: 'qa-profile/session-host',
    legacyDatabasePath: 'qa-profile/openwaggle.sqlite',
    databasePath: 'qa-profile/session-host/session-host.sqlite',
    recoveryDatabasePath: 'qa-profile/session-host/pre-cutover-openwaggle.sqlite',
    credentialPath: 'qa-profile/session-host/local-user.credential',
    endpoint: windows
      ? '\\\\.\\pipe\\openwaggle-test-session-host'
      : 'qa-profile/session-host/host.sock',
    endpointDirectory: windows ? null : 'qa-profile/session-host',
    endpointCapabilityPath: windows ? 'qa-profile/session-host/endpoint.capability' : null,
  } satisfies LocalSessionHostPaths
}

function ownership() {
  return {
    targetPath: 'qa-profile/session-host/session-host.sqlite',
    release: vi.fn(),
  } satisfies SessionHostOwnership
}

describe('shutdownSessionHostForQa', () => {
  it.each(['win32', 'linux', 'darwin'] satisfies NodeJS.Platform[])(
    'drains and waits for endpoint and ownership release on %s',
    async (platform) => {
      const hostPaths = paths(platform)
      const releasedOwnership = ownership()
      const requestStop = vi.fn(async () => undefined)
      const canConnect = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false)
      const tryAcquireOwnership = vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue(releasedOwnership)
      let now = 0

      await shutdownSessionHostForQa(
        'qa-profile',
        async () => {
          expect(releasedOwnership.release).not.toHaveBeenCalled()
        },
        1_000,
        {
          resolvePaths: () => hostPaths,
          refreshPaths: async () => hostPaths,
          requestStop,
          processExists: () => false,
          canConnect,
          tryAcquireOwnership,
          now: () => now,
          wait: async (milliseconds) => {
            now += milliseconds
          },
        },
      )

      expect(requestStop).toHaveBeenCalledWith(hostPaths)
      expect(canConnect).toHaveBeenCalledWith(hostPaths.endpoint)
      expect(tryAcquireOwnership).toHaveBeenCalledWith(hostPaths.databasePath)
      expect(releasedOwnership.release).toHaveBeenCalledOnce()
    },
  )

  it('handles a Windows Host that exited before its endpoint capability could be refreshed', async () => {
    const hostPaths = paths('win32')
    const releasedOwnership = ownership()
    const requestStop = vi.fn(async () => undefined)
    const canConnect = vi.fn()
    const missingCapability = Object.assign(new Error('missing capability'), { code: 'ENOENT' })

    await shutdownSessionHostForQa(
      'qa-profile',
      async () => {
        expect(releasedOwnership.release).not.toHaveBeenCalled()
      },
      1_000,
      {
        resolvePaths: () => hostPaths,
        refreshPaths: async () => Promise.reject(missingCapability),
        requestStop,
        processExists: () => false,
        canConnect,
        tryAcquireOwnership: async () => releasedOwnership,
        now: () => 0,
        wait: vi.fn(),
      },
    )

    expect(requestStop).not.toHaveBeenCalled()
    expect(canConnect).not.toHaveBeenCalled()
    expect(releasedOwnership.release).toHaveBeenCalledOnce()
  })

  it('fails without deleting state when ownership is not released before the timeout', async () => {
    const hostPaths = paths('win32')
    let now = 0

    await expect(
      shutdownSessionHostForQa('qa-profile', vi.fn(), 100, {
        resolvePaths: () => hostPaths,
        refreshPaths: async () => hostPaths,
        requestStop: async () => undefined,
        processExists: () => false,
        canConnect: async () => false,
        tryAcquireOwnership: async () => null,
        now: () => now,
        wait: async (milliseconds) => {
          now += milliseconds
        },
      }),
    ).rejects.toThrow('waiting for the QA Session Host to release')
  })

  it('blocks a competing ownership acquisition until profile deletion finishes', async () => {
    const hostPaths = paths('win32')
    let ownershipHeld = false
    const release = vi.fn(async () => {
      ownershipHeld = false
    })
    const tryAcquireOwnership = vi.fn(async () => {
      if (ownershipHeld) return null
      ownershipHeld = true
      return { targetPath: hostPaths.databasePath, release } satisfies SessionHostOwnership
    })

    await shutdownSessionHostForQa(
      'qa-profile',
      async () => {
        await expect(tryAcquireOwnership()).resolves.toBeNull()
        expect(release).not.toHaveBeenCalled()
      },
      1_000,
      {
        resolvePaths: () => hostPaths,
        refreshPaths: async () => hostPaths,
        requestStop: async () => undefined,
        processExists: () => false,
        canConnect: async () => false,
        tryAcquireOwnership,
        now: () => 0,
        wait: vi.fn(),
      },
    )

    await expect(tryAcquireOwnership()).resolves.toMatchObject({
      targetPath: hostPaths.databasePath,
    })
    expect(release).toHaveBeenCalledOnce()
  })

  it('preserves profile deletion failure when ownership release also fails', async () => {
    const hostPaths = paths('linux')
    const profileFailure = new Error('profile deletion failed')
    const releaseFailure = new Error('ownership release failed')

    await expect(
      shutdownSessionHostForQa('qa-profile', async () => Promise.reject(profileFailure), 1_000, {
        resolvePaths: () => hostPaths,
        refreshPaths: async () => hostPaths,
        requestStop: async () => undefined,
        processExists: () => false,
        canConnect: async () => false,
        tryAcquireOwnership: async () => ({
          targetPath: hostPaths.databasePath,
          release: async () => Promise.reject(releaseFailure),
        }),
        now: () => 0,
        wait: vi.fn(),
      }),
    ).rejects.toMatchObject({
      errors: [profileFailure, releaseFailure],
    })
  })

  it("waits for the stopped Host's process to exit, not just its ownership release, before cleanup", async () => {
    // On Windows the Host releases ownership and still holds its Chromium profile (session-data)
    // for about half a second until it exits, and the removal failed with EBUSY.
    const hostPaths = paths('win32')
    const releasedOwnership = ownership()
    let now = 0
    let alive = 3
    const events: string[] = []

    await shutdownSessionHostForQa(
      'qa-profile',
      async () => {
        events.push('cleanup')
      },
      1_000,
      {
        resolvePaths: () => hostPaths,
        refreshPaths: async () => hostPaths,
        requestStop: async () => 4242,
        processExists: (processId) => {
          expect(processId).toBe(4242)
          const running = alive > 0
          alive -= 1
          events.push(running ? 'host running' : 'host exited')
          return running
        },
        canConnect: async () => false,
        tryAcquireOwnership: async () => releasedOwnership,
        now: () => now,
        wait: async (milliseconds) => {
          now += milliseconds
        },
      },
    )

    expect(events).toEqual([
      'host running',
      'host running',
      'host running',
      'host exited',
      'cleanup',
    ])
  })

  it('removes the profile after the exit budget when the process id never disappears', async () => {
    // A reused process id must not hold the cleanup to its timeout and fail a release job.
    const hostPaths = paths('win32')
    const heldOwnership = ownership()
    let now = 0
    const cleanedAt: number[] = []

    await shutdownSessionHostForQa(
      'qa-profile',
      async () => {
        cleanedAt.push(now)
      },
      undefined,
      {
        resolvePaths: () => hostPaths,
        refreshPaths: async () => hostPaths,
        requestStop: async () => 4242,
        processExists: () => true,
        canConnect: async () => false,
        tryAcquireOwnership: async () => heldOwnership,
        now: () => now,
        wait: async (milliseconds) => {
          now += milliseconds
        },
      },
    )

    expect(cleanedAt).toEqual([SESSION_HOST_EXIT_BUDGET_MS])
    expect(heldOwnership.release).toHaveBeenCalledOnce()
  })
})
