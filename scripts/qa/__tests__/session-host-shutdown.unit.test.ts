import { describe, expect, it, vi } from 'vitest'
import type { LocalSessionHostPaths } from '../../../src/main/session-host/local-session-paths'
import type { SessionHostOwnership } from '../../../src/main/session-host/session-host-ownership'
import { shutdownSessionHostForQa } from '../session-host-shutdown'

function paths(platform: NodeJS.Platform): LocalSessionHostPaths {
  const windows = platform === 'win32'
  return {
    stateRoot: 'qa-profile/session-host',
    legacyDatabasePath: 'qa-profile/openwaggle.sqlite',
    databasePath: 'qa-profile/session-host/session-host.sqlite',
    recoveryDatabasePath: 'qa-profile/session-host/pre-cutover-openwaggle.sqlite',
    credentialPath: 'qa-profile/session-host/local-user.credential',
    endpoint: windows ? '\\\\.\\pipe\\openwaggle-test-session-host' : 'qa-profile/session-host/host.sock',
    endpointDirectory: windows ? null : 'qa-profile/session-host',
    endpointCapabilityPath: windows ? 'qa-profile/session-host/endpoint.capability' : null,
  }
}

function ownership(): SessionHostOwnership {
  return { targetPath: 'qa-profile/session-host/session-host.sqlite', release: vi.fn() }
}

describe('shutdownSessionHostForQa', () => {
  it.each(['win32', 'linux', 'darwin'] satisfies NodeJS.Platform[])(
    'drains and waits for endpoint and ownership release on %s',
    async (platform) => {
      const hostPaths = paths(platform)
      const releasedOwnership = ownership()
      const requestDrain = vi.fn()
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
          requestDrain,
          canConnect,
          tryAcquireOwnership,
          now: () => now,
          wait: async (milliseconds) => {
            now += milliseconds
          },
        },
      )

      expect(requestDrain).toHaveBeenCalledWith(hostPaths)
      expect(canConnect).toHaveBeenCalledWith(hostPaths.endpoint)
      expect(tryAcquireOwnership).toHaveBeenCalledWith(hostPaths.databasePath)
      expect(releasedOwnership.release).toHaveBeenCalledOnce()
    },
  )

  it('handles a Windows Host that exited before its endpoint capability could be refreshed', async () => {
    const hostPaths = paths('win32')
    const releasedOwnership = ownership()
    const requestDrain = vi.fn()
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
        requestDrain,
        canConnect,
        tryAcquireOwnership: async () => releasedOwnership,
        now: () => 0,
        wait: vi.fn(),
      },
    )

    expect(requestDrain).not.toHaveBeenCalled()
    expect(canConnect).not.toHaveBeenCalled()
    expect(releasedOwnership.release).toHaveBeenCalledOnce()
  })

  it('fails without deleting state when ownership is not released before the timeout', async () => {
    const hostPaths = paths('win32')
    let now = 0

    await expect(
      shutdownSessionHostForQa(
        'qa-profile',
        vi.fn(),
        100,
        {
          resolvePaths: () => hostPaths,
          refreshPaths: async () => hostPaths,
          requestDrain: vi.fn(),
          canConnect: async () => false,
          tryAcquireOwnership: async () => null,
          now: () => now,
          wait: async (milliseconds) => {
            now += milliseconds
          },
        },
      ),
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
        requestDrain: vi.fn(),
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
      shutdownSessionHostForQa(
        'qa-profile',
        async () => Promise.reject(profileFailure),
        1_000,
        {
          resolvePaths: () => hostPaths,
          refreshPaths: async () => hostPaths,
          requestDrain: vi.fn(),
          canConnect: async () => false,
          tryAcquireOwnership: async () => ({
            targetPath: hostPaths.databasePath,
            release: async () => Promise.reject(releaseFailure),
          }),
          now: () => 0,
          wait: vi.fn(),
        },
      ),
    ).rejects.toMatchObject({
      errors: [profileFailure, releaseFailure],
    })
  })
})
