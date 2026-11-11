import { describe, expect, it, vi } from 'vitest'

vi.mock('../desktop-shell/app-lifecycle', async () => ({
  appLifecycle: (await import('../test-support/fake-desktop-shell')).fakeAppLifecycle(),
}))
vi.mock('../desktop-shell/app-paths', async () => ({
  appPaths: (await import('../test-support/fake-desktop-shell')).fakeAppPaths(),
}))
vi.mock('../desktop-shell/system-integration', async () => ({
  systemIntegration: (await import('../test-support/fake-desktop-shell')).fakeSystemIntegration(),
}))

const { linuxAutostartEntry, macLaunchAgentPlist, readBackgroundStart, writeBackgroundStart } =
  await import('../background-start')

const MAC_APP = '/Applications/Open & Waggle.app/Contents'

describe('Background start', () => {
  it('starts only the Session Host at login on macOS', () => {
    const plist = macLaunchAgentPlist([`${MAC_APP}/MacOS/bun`, `${MAC_APP}/Resources/app`])
    expect(plist).toContain(
      '<string>/Applications/Open &amp; Waggle.app/Contents/MacOS/bun</string>\n' +
        '    <string>/Applications/Open &amp; Waggle.app/Contents/Resources/app</string>',
    )
    expect(plist).toContain(
      '<string>--</string>\n    <string>host</string>\n    <string>start</string>',
    )
    expect(plist).toContain('<key>RunAtLoad</key>\n  <true/>')
  })

  it('quotes each part of the command in the Linux autostart entry', () => {
    const entry = linuxAutostartEntry(['/opt/Open "Waggle"/bin/bun', '/opt/Open "Waggle"/app'])
    expect(entry).toContain(
      'Exec="/opt/Open \\"Waggle\\"/bin/bun" "/opt/Open \\"Waggle\\"/app" -- host start',
    )
    expect(entry).toContain('NoDisplay=true')
  })

  it('is unavailable in development builds, and changes nothing there', async () => {
    await expect(readBackgroundStart()).resolves.toMatchObject({ supported: false, enabled: false })
    await expect(writeBackgroundStart(true)).resolves.toMatchObject({ supported: false })
  })
})
