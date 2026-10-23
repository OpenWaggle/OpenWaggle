import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp/config',
    getLoginItemSettings: () => ({ openAtLogin: false }),
    setLoginItemSettings: vi.fn(),
  },
}))

const { linuxAutostartEntry, macLaunchAgentPlist, readBackgroundStart, writeBackgroundStart } =
  await import('../background-start')

describe('Background start', () => {
  it('starts only the Session Host at login on macOS', () => {
    const plist = macLaunchAgentPlist('/Applications/Open & Waggle.app/Contents/MacOS/OpenWaggle')
    expect(plist).toContain(
      '<string>/Applications/Open &amp; Waggle.app/Contents/MacOS/OpenWaggle</string>',
    )
    expect(plist).toContain(
      '<string>--</string>\n    <string>host</string>\n    <string>start</string>',
    )
    expect(plist).toContain('<key>RunAtLoad</key>\n  <true/>')
  })

  it('quotes the AppImage path in the Linux autostart entry', () => {
    const entry = linuxAutostartEntry('/home/me/Apps/Open "Waggle".AppImage')
    expect(entry).toContain('Exec="/home/me/Apps/Open \\"Waggle\\".AppImage" -- host start')
    expect(entry).toContain('NoDisplay=true')
  })

  it('is unavailable in development builds, and changes nothing there', async () => {
    await expect(readBackgroundStart()).resolves.toMatchObject({ supported: false, enabled: false })
    await expect(writeBackgroundStart(true)).resolves.toMatchObject({ supported: false })
  })
})
