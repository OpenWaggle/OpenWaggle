import { describe, expect, it, vi } from 'vitest'
import { applicationCliArguments } from '../../application-cli-arguments'

const mocks = vi.hoisted(() => ({ switches: new Map<string, string>() }))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/workspace/OpenWaggle',
    commandLine: {
      hasSwitch: (name: string) => mocks.switches.has(name),
      getSwitchValue: (name: string) => mocks.switches.get(name) ?? '',
    },
  },
}))

import {
  currentSessionHostLaunchCommand,
  sessionHostLaunchCommand,
} from '../local-session-host-launcher'

const devLaunch = {
  isPackaged: false,
  executablePath: '/opt/electron',
  appPath: '/workspace/OpenWaggle',
}

/*
 * QA starts the GUI with Chromium's --use-mock-keychain (and --password-store=basic on Linux) so
 * no credential prompt reaches the maintainer's screen. The detached Host the GUI launches reads
 * and writes credentials too, so it must run with the same switches.
 */
describe('Session Host inherited credential store switches', () => {
  it.each(['darwin', 'linux', 'win32'] as const)(
    'forwards --use-mock-keychain on %s',
    (platform) => {
      expect(
        sessionHostLaunchCommand({ ...devLaunch, platform, parentUseMockKeychain: true }).args,
      ).toEqual(['--use-mock-keychain', '/workspace/OpenWaggle', 'session-host-internal'])
    },
  )

  it("forwards Linux's --password-store with the GUI's value", () => {
    expect(
      sessionHostLaunchCommand({
        ...devLaunch,
        platform: 'linux',
        parentUseMockKeychain: true,
        parentPasswordStore: 'basic',
      }).args,
    ).toEqual([
      '--use-mock-keychain',
      '--password-store=basic',
      '/workspace/OpenWaggle',
      'session-host-internal',
    ])
  })

  it('ignores --password-store outside Linux, where Chromium has no such switch', () => {
    expect(
      sessionHostLaunchCommand({ ...devLaunch, platform: 'darwin', parentPasswordStore: 'basic' })
        .args,
    ).toEqual(['/workspace/OpenWaggle', 'session-host-internal'])
  })

  it('keeps the switches through the stable AppImage executable', () => {
    expect(
      sessionHostLaunchCommand({
        platform: 'linux',
        isPackaged: true,
        executablePath: '/tmp/.mount_openwaggle/openwaggle',
        appPath: '/tmp/.mount_openwaggle/resources/app.asar',
        appImagePath: '/opt/OpenWaggle.AppImage',
        parentNoSandbox: true,
        parentUseMockKeychain: true,
        parentPasswordStore: 'basic',
      }),
    ).toEqual({
      command: '/opt/OpenWaggle.AppImage',
      args: [
        '--no-sandbox',
        '--use-mock-keychain',
        '--password-store=basic',
        'session-host-internal',
      ],
    })
  })

  it.each([false, true])('still routes the launch to the Host when packaged=%s', (isPackaged) => {
    const launch = sessionHostLaunchCommand({
      ...devLaunch,
      isPackaged,
      platform: 'linux',
      parentUseMockKeychain: true,
      parentPasswordStore: 'basic',
    })

    expect(applicationCliArguments([launch.command, ...launch.args], { isPackaged })).toEqual([
      'session-host-internal',
    ])
  })

  it("reads the switches from the GUI's own command line", () => {
    mocks.switches.set('use-mock-keychain', '')
    mocks.switches.set('password-store', 'basic')
    try {
      const { args } = currentSessionHostLaunchCommand()

      expect(args).toContain('--use-mock-keychain')
      expect(args.includes('--password-store=basic')).toBe(process.platform === 'linux')
    } finally {
      mocks.switches.clear()
    }
  })

  it('adds no switch the GUI was not started with', () => {
    expect(currentSessionHostLaunchCommand().args).toEqual([
      '/workspace/OpenWaggle',
      'session-host-internal',
    ])
  })
})
