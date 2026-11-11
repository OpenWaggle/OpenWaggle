import { describe, expect, it, vi } from 'vitest'
import { applicationCliArguments } from '../../application-cli-arguments'

const mocks = vi.hoisted(() => ({ switches: new Map<string, string>() }))

vi.mock('../../desktop-shell/app-lifecycle', async () => ({
  appLifecycle: (await import('../../test-support/fake-desktop-shell')).fakeAppLifecycle({
    commandLine: {
      appendSwitch: () => undefined,
      hasSwitch: (name: string) => mocks.switches.has(name),
      getSwitchValue: (name: string) => mocks.switches.get(name) ?? '',
    },
  }),
}))
vi.mock('../../desktop-shell/app-paths', async () => ({
  appPaths: {
    ...(await import('../../test-support/fake-desktop-shell')).fakeAppPaths(),
    appRoot: () => '/workspace/OpenWaggle',
  },
}))

import {
  currentSessionHostLaunchCommand,
  sessionHostLaunchCommand,
} from '../local-session-host-launcher'

const devLaunch = { executablePath: '/opt/bun', appPath: '/workspace/OpenWaggle' }

/*
 * QA starts the GUI with --use-mock-keychain (and --password-store=basic on Linux) so no
 * credential prompt reaches the maintainer's screen. The detached Host the GUI launches reads and
 * writes credentials too, so it runs with the same switches, after the app path Bun runs.
 */
describe('Session Host inherited credential store switches', () => {
  it.each(['darwin', 'linux', 'win32'] as const)(
    'forwards --use-mock-keychain on %s',
    (platform) => {
      expect(
        sessionHostLaunchCommand({ ...devLaunch, platform, parentUseMockKeychain: true }).args,
      ).toEqual(['/workspace/OpenWaggle', '--use-mock-keychain', 'session-host-internal'])
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
      '/workspace/OpenWaggle',
      '--use-mock-keychain',
      '--password-store=basic',
      'session-host-internal',
    ])
  })

  it('ignores --password-store outside Linux', () => {
    expect(
      sessionHostLaunchCommand({ ...devLaunch, platform: 'darwin', parentPasswordStore: 'basic' })
        .args,
    ).toEqual(['/workspace/OpenWaggle', 'session-host-internal'])
  })

  it('still routes the launch to the Host', () => {
    const launch = sessionHostLaunchCommand({
      ...devLaunch,
      platform: 'linux',
      parentNoSandbox: true,
      parentUseMockKeychain: true,
      parentPasswordStore: 'basic',
    })
    // Bun's argv: the runtime, the app's boot.js it resolved from the app path, then the rest.
    const [, ...rest] = launch.args
    expect(
      applicationCliArguments([launch.command, '/workspace/OpenWaggle/out/main/boot.js', ...rest]),
    ).toEqual(['session-host-internal'])
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
