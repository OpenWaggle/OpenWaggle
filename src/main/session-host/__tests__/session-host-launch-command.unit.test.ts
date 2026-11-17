import { describe, expect, it } from 'vitest'
import {
  sessionHostLaunchArguments,
  sessionHostLaunchCommand,
} from '../session-host-launch-command'

describe('Session Host launch command', () => {
  it('includes the Electron application path for a cold development Host', () => {
    expect(
      sessionHostLaunchArguments({ isPackaged: false, appPath: '/workspace/OpenWaggle' }),
    ).toEqual(['/workspace/OpenWaggle', 'session-host-internal'])
    expect(
      sessionHostLaunchArguments({ isPackaged: true, appPath: '/Applications/OpenWaggle.app' }),
    ).toEqual(['session-host-internal'])
  })

  it('launches a packaged Linux Host from the stable AppImage mount source', () => {
    expect(
      sessionHostLaunchCommand({
        platform: 'linux',
        isPackaged: true,
        executablePath: '/tmp/.mount_openwaggle/openwaggle',
        appPath: '/tmp/.mount_openwaggle/resources/app.asar',
        appImagePath: '/opt/OpenWaggle.AppImage',
      }),
    ).toEqual({ command: '/opt/OpenWaggle.AppImage', args: ['session-host-internal'] })
  })

  it('keeps the Electron executable for development and non-AppImage packages', () => {
    expect(
      sessionHostLaunchCommand({
        platform: 'linux',
        isPackaged: false,
        executablePath: '/workspace/node_modules/electron/dist/electron',
        appPath: '/workspace/OpenWaggle',
        appImagePath: '/opt/OpenWaggle.AppImage',
      }),
    ).toEqual({
      command: '/workspace/node_modules/electron/dist/electron',
      args: ['/workspace/OpenWaggle', 'session-host-internal'],
    })
    expect(
      sessionHostLaunchCommand({
        platform: 'darwin',
        isPackaged: true,
        executablePath: '/Applications/OpenWaggle.app/Contents/MacOS/OpenWaggle',
        appPath: '/Applications/OpenWaggle.app/Contents/Resources/app.asar',
      }),
    ).toEqual({
      command: '/Applications/OpenWaggle.app/Contents/MacOS/OpenWaggle',
      args: ['session-host-internal'],
    })
  })
})
