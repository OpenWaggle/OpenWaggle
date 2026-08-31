import { describe, expect, it, vi } from 'vitest'
import { assertInstalledCliResponse, verifyInstalledCli } from '../verify-installed-cli'

const VALID_RESPONSE = JSON.stringify({
  schemaVersion: 1,
  type: 'response',
  command: 'list',
  result: { contract: 'local-session-v1', response: { outcome: { sessions: [] } } },
})

describe('installed CLI verification', () => {
  it.each(['linux', 'darwin', 'win32'] satisfies NodeJS.Platform[])(
    'runs the installed command with an isolated profile and cleans its Host on %s',
    async (platform) => {
      const runCli = vi.fn(async () => ({ stdout: VALID_RESPONSE, stderr: '' }))
      const shutdownAndRemoveProfile = vi.fn(async () => undefined)

      await verifyInstalledCli('/installed/openwaggle', platform, {
        createProfile: async () => '/isolated/profile',
        runCli,
        shutdownAndRemoveProfile,
      })

      expect(runCli).toHaveBeenCalledWith(
        '/installed/openwaggle',
        ['sessions', 'list', '--all', '--limit', '1', '--json'],
        expect.objectContaining({
          OPENWAGGLE_AUTOMATION: '1',
          OPENWAGGLE_DISABLE_SINGLE_INSTANCE: '1',
          OPENWAGGLE_USER_DATA_DIR: '/isolated/profile',
        }),
        platform,
      )
      expect(shutdownAndRemoveProfile).toHaveBeenCalledWith('/isolated/profile')
    },
  )

  it('rejects a successful process that does not return the versioned sessions response', () => {
    expect(() => assertInstalledCliResponse('{}', 'darwin')).toThrow(
      'invalid sessions list response',
    )
  })

  it('preserves the CLI failure when Host cleanup also fails', async () => {
    const cliFailure = new Error('CLI failed')
    const cleanupFailure = new Error('cleanup failed')

    await expect(
      verifyInstalledCli('/installed/openwaggle', 'linux', {
        createProfile: async () => '/retained/profile',
        runCli: async () => Promise.reject(cliFailure),
        shutdownAndRemoveProfile: async () => Promise.reject(cleanupFailure),
      }),
    ).rejects.toMatchObject({ errors: [cliFailure, cleanupFailure] })
  })
})
