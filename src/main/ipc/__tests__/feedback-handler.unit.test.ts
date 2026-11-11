import os from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { harness, invoke, writeLogs } from './feedback-handler.test-harness'

describe('feedback:check-gh', () => {
  // Pins fix(ipc): answer feedback:check-gh when gh is missing or signed out. A failed `which` or
  // `gh auth status` failed the whole request instead of reporting gh unavailable.
  it.each([
    { which: false, auth: false, expected: { available: false, authenticated: false } },
    { which: true, auth: false, expected: { available: true, authenticated: false } },
    { which: true, auth: true, expected: { available: true, authenticated: true } },
  ])('reports gh $expected', async ({ which, auth, expected }) => {
    if (which) harness.replies.set('which gh', { stdout: '/usr/bin/gh\n' })
    if (auth) harness.replies.set('gh auth status', {})

    await expect(invoke('feedback:check-gh')).resolves.toEqual(expected)
    // gh never sees a token from the app's environment; it uses its own login.
    for (const { env } of harness.spawned) expect(env ?? {}).not.toHaveProperty('GH_TOKEN')
  })
})

describe('feedback:collect-diagnostics', () => {
  it.each<[NodeJS.Platform, string]>([
    ['darwin', 'macOS'],
    ['win32', 'Windows'],
    ['linux', 'Linux'],
    ['freebsd', 'freebsd'],
  ])('names %s as %s with the app version', async (platform, name) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)

    await expect(invoke('feedback:collect-diagnostics')).resolves.toEqual({
      os: `${name} ${os.release()}`,
      appVersion: '0.1.0-test',
      runtimeVersion: `Bun ${process.versions['bun'] ?? 'unknown'}`,
      nodeVersion: process.versions.node,
      arch: process.arch,
    })
  })
})

describe('feedback:get-recent-logs', () => {
  it('returns nothing when the app has no log file', async () => {
    await expect(invoke('feedback:get-recent-logs', 50)).resolves.toBe('')
  })

  it('returns the last lines of the GUI and Session Host logs, redacted', async () => {
    await writeLogs(
      'gui 1\ngui 2\ngui 3 Authorization: Bearer abcdef0123456789secret',
      'host 1\nhost 2',
    )

    await expect(invoke('feedback:get-recent-logs', 2)).resolves.toBe(
      'gui 2\ngui 3 Authorization: Bearer [REDACTED_TOKEN]\n' +
        '--- Session Host (openwaggle-host-2026-11-11.log) ---\nhost 1\nhost 2',
    )
  })

  it('returns the GUI log alone when the Session Host has no log', async () => {
    await writeLogs('gui 1\ngui 2')

    await expect(invoke('feedback:get-recent-logs', 5)).resolves.toBe('gui 1\ngui 2')
  })

  it('reads a log once when its name has no GUI stem to map to the Host', async () => {
    await writeLogs('only line', undefined, 'custom.log')

    await expect(invoke('feedback:get-recent-logs', 5)).resolves.toBe('only line')
  })
})
