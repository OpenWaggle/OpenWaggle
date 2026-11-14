import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { devAppEnvironment, devAppLaunchCommand } from '../dev-app-startup-smoke'

describe('development app startup smoke', () => {
  it.each([
    ['win32', ['--use-mock-keychain']],
    ['darwin', ['--use-mock-keychain']],
    ['linux', ['--use-mock-keychain', '--password-store=basic']],
  ] satisfies [NodeJS.Platform, string[]][])(
    'runs `bun run dev` on %s with the mock credential store after a second `--`',
    (platform, switches) => {
      expect(devAppLaunchCommand(platform, '/opt/bun/bin/bun')).toEqual({
        command: '/opt/bun/bin/bun',
        args: ['run', 'dev', '--', '--', ...switches],
      })
    },
  )

  it('keeps the caller environment for Bun but no Session identity or real profile', () => {
    const root = path.join('/tmp', 'dev-startup')
    const environment = devAppEnvironment(root, {
      PATH: '/bin',
      APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
      OPENWAGGLE_AGENT_RUN: '1',
      OPENWAGGLE_USER_DATA_DIR: '/real/profile',
      PI_SESSION_ID: 'session',
      Pi_Session_File: 'file',
      ELECTRON_RUN_AS_NODE: '1',
      HOME: '/Users/me',
    })

    const home = path.join(root, 'home')
    expect(environment).toEqual({
      PATH: '/bin',
      APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
      HOME: home,
      USERPROFILE: home,
      PI_CODING_AGENT_DIR: path.join(home, '.pi', 'agent'),
      OPENWAGGLE_AUTOMATION: '1',
      OPENWAGGLE_DISABLE_SINGLE_INSTANCE: '1',
      OPENWAGGLE_USER_DATA_DIR: root,
    })
  })
})
