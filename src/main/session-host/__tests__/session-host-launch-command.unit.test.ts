import { describe, expect, it } from 'vitest'
import { applicationCliArguments } from '../../application-cli-arguments'
import {
  sessionHostLaunchArguments,
  sessionHostLaunchCommand,
  sessionHostLaunchCommandFor,
  type SessionHostLaunchSwitches,
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

/**
 * A Linux desktop whose native Wayland (or GPU) stack is broken starts the app with Chromium's
 * display-backend switches; the detached Host is the same Electron runtime and needs them too
 * (Ubuntu 26.04 Wayland + Vulkan report, beta.43). Without the forwarding the Host dies on the
 * backend the user escaped, and the GUI shows its startup-timeout screen.
 */
function switchesOf(values: Readonly<Record<string, string>>) {
  const commandLine = {
    hasSwitch: (name: string) => name in values,
    getSwitchValue: (name: string) => values[name] ?? '',
  } satisfies SessionHostLaunchSwitches
  return commandLine
}

describe('Session Host inherited Linux display backend switches', () => {
  const packagedAppImage = {
    platform: 'linux' as const,
    isPackaged: true,
    executablePath: '/tmp/.mount_openwaggle/openwaggle',
    appPath: '/tmp/.mount_openwaggle/resources/app.asar',
    appImagePath: '/opt/OpenWaggle.AppImage',
  }

  it("forwards the GUI's --ozone-platform to the Host", () => {
    expect(
      sessionHostLaunchCommandFor({
        ...packagedAppImage,
        commandLine: switchesOf({ 'ozone-platform': 'x11' }),
      }),
    ).toEqual({
      command: '/opt/OpenWaggle.AppImage',
      args: ['--ozone-platform=x11', 'session-host-internal'],
    })
  })

  it.each([
    ['an --ozone-platform-hint', { 'ozone-platform-hint': 'auto' }, ['--ozone-platform-hint=auto']],
    [
      'an --ozone-platform with --disable-gpu',
      { 'ozone-platform': 'x11', 'disable-gpu': '' },
      ['--ozone-platform=x11', '--disable-gpu'],
    ],
  ])('forwards %s to the Host', (_label, values, expectedSwitches) => {
    const { command, args } = sessionHostLaunchCommandFor({
      ...packagedAppImage,
      commandLine: switchesOf(values),
    })

    expect(command).toBe('/opt/OpenWaggle.AppImage')
    expect(args).toEqual([...expectedSwitches, 'session-host-internal'])
  })

  it('keeps the display switches in a development launch, before the app path', () => {
    expect(
      sessionHostLaunchCommandFor({
        platform: 'linux',
        isPackaged: false,
        executablePath: '/workspace/node_modules/electron/dist/electron',
        appPath: '/workspace/OpenWaggle',
        commandLine: switchesOf({ 'ozone-platform': 'x11' }),
      }),
    ).toEqual({
      command: '/workspace/node_modules/electron/dist/electron',
      args: ['--ozone-platform=x11', '/workspace/OpenWaggle', 'session-host-internal'],
    })
  })

  it.each([false, true])(
    'still routes the forwarded launch to the Host when packaged=%s',
    (isPackaged) => {
      const launch = sessionHostLaunchCommandFor({
        platform: 'linux',
        isPackaged,
        executablePath: '/tmp/.mount_openwaggle/openwaggle',
        appPath: '/workspace/OpenWaggle',
        appImagePath: '/opt/OpenWaggle.AppImage',
        commandLine: switchesOf({ 'ozone-platform': 'x11', 'disable-gpu': '' }),
      })

      expect(applicationCliArguments([launch.command, ...launch.args], { isPackaged })).toEqual([
        'session-host-internal',
      ])
    },
  )

  it('ignores the display switches outside Linux, where Chromium has no Ozone backend', () => {
    expect(
      sessionHostLaunchCommandFor({
        platform: 'darwin',
        isPackaged: true,
        executablePath: '/Applications/OpenWaggle.app/Contents/MacOS/OpenWaggle',
        appPath: '/Applications/OpenWaggle.app/Contents/Resources/app.asar',
        commandLine: switchesOf({
          'ozone-platform': 'x11',
          'ozone-platform-hint': 'auto',
          'disable-gpu': '',
        }),
      }).args,
    ).toEqual(['session-host-internal'])
  })
})
