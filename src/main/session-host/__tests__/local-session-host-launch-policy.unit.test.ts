import { describe, expect, it } from 'vitest'
import { applicationCliArguments } from '../../application-cli-arguments'
import { sessionHostLaunchCommand } from '../local-session-host-launcher'

const launch = { executablePath: '/opt/bun', appPath: '/workspace/OpenWaggle' }

describe('Session Host inherited Linux sandbox policy', () => {
  it('forwards an explicit parent switch after the app path', () => {
    expect(
      sessionHostLaunchCommand({ ...launch, platform: 'linux', parentNoSandbox: true }),
    ).toEqual({
      command: '/opt/bun',
      args: ['/workspace/OpenWaggle', '--no-sandbox', 'session-host-internal'],
    })
  })

  it('routes the inherited launch to the Host', () => {
    const command = sessionHostLaunchCommand({
      ...launch,
      platform: 'linux',
      parentNoSandbox: true,
    })
    const [, ...rest] = command.args
    expect(
      applicationCliArguments([command.command, '/workspace/OpenWaggle/out/main/boot.js', ...rest]),
    ).toEqual(['session-host-internal'])
  })

  it.each(['linux', 'darwin', 'win32'] as const)(
    'does not disable the sandbox by default on %s',
    (platform) => {
      expect(sessionHostLaunchCommand({ ...launch, platform }).args).toEqual([
        '/workspace/OpenWaggle',
        'session-host-internal',
      ])
    },
  )

  it.each(['darwin', 'win32'] as const)('ignores the Linux switch on %s', (platform) => {
    expect(sessionHostLaunchCommand({ ...launch, platform, parentNoSandbox: true }).args).toEqual([
      '/workspace/OpenWaggle',
      'session-host-internal',
    ])
  })
})
