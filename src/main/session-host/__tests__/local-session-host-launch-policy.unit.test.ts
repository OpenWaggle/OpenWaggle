import { describe, expect, it } from 'vitest'
import { applicationCliArguments } from '../../application-cli-arguments'
import { sessionHostLaunchCommand } from '../local-session-host-launcher'

describe('Session Host inherited Linux sandbox policy', () => {
  it.each([false, true])('forwards an explicit parent switch when packaged=%s', (isPackaged) => {
    const launch = {
      platform: 'linux' as const,
      isPackaged,
      executablePath: '/opt/electron',
      appPath: '/workspace/OpenWaggle',
      parentNoSandbox: true,
    }

    expect(sessionHostLaunchCommand(launch)).toEqual({
      command: '/opt/electron',
      args: isPackaged
        ? ['--no-sandbox', 'session-host-internal']
        : ['--no-sandbox', '/workspace/OpenWaggle', 'session-host-internal'],
    })
  })

  it('preserves an explicit parent switch through the stable AppImage executable', () => {
    const launch = {
      platform: 'linux' as const,
      isPackaged: true,
      executablePath: '/tmp/.mount_openwaggle/openwaggle',
      appPath: '/tmp/.mount_openwaggle/resources/app.asar',
      appImagePath: '/opt/OpenWaggle.AppImage',
      parentNoSandbox: true,
    }

    expect(sessionHostLaunchCommand(launch)).toEqual({
      command: '/opt/OpenWaggle.AppImage',
      args: ['--no-sandbox', 'session-host-internal'],
    })
  })

  it.each([false, true])(
    'routes the inherited launch to the Host when packaged=%s',
    (isPackaged) => {
      const launch = sessionHostLaunchCommand({
        platform: 'linux',
        isPackaged,
        executablePath: '/opt/electron',
        appPath: '/workspace/OpenWaggle',
        parentNoSandbox: true,
      })

      expect(applicationCliArguments([launch.command, ...launch.args], { isPackaged })).toEqual([
        'session-host-internal',
      ])
    },
  )

  it.each(['linux', 'darwin', 'win32'] as const)(
    'does not disable the sandbox by default on %s',
    (platform) => {
      expect(
        sessionHostLaunchCommand({
          platform,
          isPackaged: false,
          executablePath: '/opt/electron',
          appPath: '/workspace/OpenWaggle',
        }).args,
      ).toEqual(['/workspace/OpenWaggle', 'session-host-internal'])
    },
  )

  it.each(['darwin', 'win32'] as const)('leaves %s launch behavior unchanged', (platform) => {
    const launch = {
      platform,
      isPackaged: true,
      executablePath: '/opt/electron',
      appPath: '/workspace/OpenWaggle',
      parentNoSandbox: true,
    }

    expect(sessionHostLaunchCommand(launch).args).toEqual(['session-host-internal'])
  })
})
