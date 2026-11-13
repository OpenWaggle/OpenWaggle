import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { devAppEnvironment, devAppLaunchCommand } from '../dev-app-startup-smoke'

describe('development app startup smoke', () => {
  it('runs `pnpm dev` through cmd.exe on Windows, as pnpm runs package scripts there', () => {
    expect(devAppLaunchCommand('win32', 'C:\\Windows\\system32\\cmd.exe')).toEqual({
      command: 'C:\\Windows\\system32\\cmd.exe',
      args: ['/d', '/s', '/c', 'pnpm dev -- --use-mock-keychain'],
    })
  })

  it.each([
    ['darwin', ['--use-mock-keychain']],
    ['linux', ['--use-mock-keychain', '--password-store=basic']],
  ] satisfies [NodeJS.Platform, string[]][])(
    'runs `pnpm dev` directly on %s with the mock credential store',
    (platform, switches) => {
      expect(devAppLaunchCommand(platform)).toEqual({
        command: 'pnpm',
        args: ['dev', '--', ...switches],
      })
    },
  )

  it('keeps the caller environment for pnpm but no Session identity or real profile', () => {
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
