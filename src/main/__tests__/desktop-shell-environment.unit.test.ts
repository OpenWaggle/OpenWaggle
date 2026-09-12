import { execFileSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { installDesktopShellEnvironment } from '../desktop-shell-environment'
import {
  extractShellEnvironment,
  readLoginShellEnvironment,
  type ShellEnvironmentCommand,
} from '../desktop-shell-environment-probes'

function captured(name: string, value: string) {
  return `__OPENWAGGLE_ENV_${name}_START__\n${value}\n__OPENWAGGLE_ENV_${name}_END__\n`
}

describe('desktop shell environment inference', () => {
  it.runIf(process.platform !== 'win32')(
    'captures only allowlisted exports with a short real-shell command',
    async () => {
      const environment = await readLoginShellEnvironment('/bin/sh', async (input) => {
        // Reproduce environments that terminate long -c arguments before execution.
        expect(input.args[1].length).toBeLessThan(512)
        return execFileSync('/bin/sh', ['-c', input.args[1]], {
          encoding: 'utf8',
          timeout: 5_000,
          env: {
            PATH: '/usr/bin:/bin',
            SSH_AUTH_SOCK: '/tmp/socket with spaces',
            XDG_CONFIG_HOME: '/tmp/config\nsecond line',
            UNRELATED_SECRET: 'must-not-be-captured',
          },
        })
      })
      expect(environment).toEqual({
        PATH: '/usr/bin:/bin',
        SSH_AUTH_SOCK: '/tmp/socket with spaces',
        XDG_CONFIG_HOME: '/tmp/config\nsecond line',
      })
    },
  )

  it('extracts requested variables from noisy interactive shell output', () => {
    const output = `shell warning\n${captured('PATH', '/profile/bin:/usr/bin')}prompt noise\n`

    expect(extractShellEnvironment(output, ['PATH', 'SSH_AUTH_SOCK'])).toEqual({
      PATH: '/profile/bin:/usr/bin',
    })
  })

  it('hydrates macOS PATH, auth, desktop, and locale values from the login shell', async () => {
    const env: Record<string, string | undefined> = {
      PATH: '/usr/bin:/bin',
      SHELL: '/bin/zsh',
    }
    const runCommand = vi.fn(async (input: ShellEnvironmentCommand) => {
      if (input.probe !== 'login-shell') return ''
      return [
        captured('PATH', '/Users/test/.volta/bin:/usr/local/bin'),
        captured('SSH_AUTH_SOCK', '/private/tmp/agent.sock'),
        captured('XDG_CURRENT_DESKTOP', 'Aqua'),
        captured('LC_CTYPE', 'en_GB.UTF-8'),
      ].join('')
    })

    await installDesktopShellEnvironment({ env, platform: 'darwin', runCommand })

    expect(env.PATH).toBe('/Users/test/.volta/bin:/usr/local/bin:/usr/bin:/bin')
    expect(env.SSH_AUTH_SOCK).toBe('/private/tmp/agent.sock')
    expect(env.XDG_CURRENT_DESKTOP).toBe('Aqua')
    expect(env.LC_CTYPE).toBe('en_GB.UTF-8')
    expect(runCommand).toHaveBeenCalledTimes(1)
  })

  it('uses launchctl PATH and a UTF-8 locale when launchd provides neither', async () => {
    const env: Record<string, string | undefined> = {}
    const runCommand = vi.fn(async (input: ShellEnvironmentCommand) =>
      input.probe === 'launchctl-path' ? '/opt/homebrew/bin:/usr/bin\n' : '',
    )

    await installDesktopShellEnvironment({
      env,
      platform: 'darwin',
      userShell: '/bin/zsh',
      runCommand,
    })

    expect(env.PATH).toBe('/opt/homebrew/bin:/usr/bin')
    expect(env.LC_CTYPE).toBe('en_US.UTF-8')
    expect(runCommand.mock.calls.some(([input]) => input.probe === 'launchctl-path')).toBe(true)
  })

  it('recovers the Linux session bus from the inferred runtime directory', async () => {
    const env: Record<string, string | undefined> = { PATH: '/usr/bin' }
    const runCommand = vi.fn(async (input: ShellEnvironmentCommand) =>
      input.probe === 'login-shell' ? captured('XDG_RUNTIME_DIR', '/run/user/501') : '',
    )

    await installDesktopShellEnvironment({
      env,
      platform: 'linux',
      uid: 501,
      exists: (path) => path === '/run/user/501/bus',
      runCommand,
    })

    expect(env.XDG_RUNTIME_DIR).toBe('/run/user/501')
    expect(env.DBUS_SESSION_BUS_ADDRESS).toBe('unix:path=/run/user/501/bus')
  })

  it('merges PowerShell profile and system paths without case-insensitive duplicates', async () => {
    const env: Record<string, string | undefined> = {
      PATH: 'C:\\Windows\\System32;C:\\Existing',
      APPDATA: 'C:\\Users\\test\\AppData\\Roaming',
    }
    const runCommand = vi.fn(async (input: ShellEnvironmentCommand) => {
      if (input.probe === 'powershell-profile') {
        return [
          captured('PATH', 'C:\\Profile;C:\\WINDOWS\\SYSTEM32'),
          captured('FNM_DIR', 'C:\\Users\\test\\.fnm'),
        ].join('')
      }
      if (input.probe === 'powershell-no-profile') return captured('PATH', 'C:\\System')
      return ''
    })

    await installDesktopShellEnvironment({ env, platform: 'win32', runCommand })

    expect(env.PATH?.split(';')).toEqual([
      'C:\\Profile',
      'C:\\WINDOWS\\SYSTEM32',
      'C:\\Users\\test\\AppData\\Roaming\\npm',
      'C:\\System',
      'C:\\Existing',
    ])
    expect(env.FNM_DIR).toBe('C:\\Users\\test\\.fnm')
  })
})
