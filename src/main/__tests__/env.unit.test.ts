import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { createProjectActionTerminalEnvironment } from '@shared/utils/terminal-environment'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getBrowserCredentialChildEnv,
  getBrowserImportPathEnv,
  getInteractiveTerminalEnv,
  getNpmCompatiblePath,
  getSafeChildEnv,
  getSessionHostChildEnv,
  getWindowsSecurityChildEnv,
} from '../env'

const MINIMAL_PATH = ['/usr/bin', '/bin'].join(delimiter)
const TEST_APP_VERSION = '1.2.3-test'

function pathEntries(value: string | undefined) {
  return value?.split(delimiter) ?? []
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('main process environment helpers', () => {
  it('adds common user tool directories to the npm-compatible PATH', () => {
    vi.stubEnv('PATH', MINIMAL_PATH)

    const entries = pathEntries(getNpmCompatiblePath())

    expect(entries).toContain(join(homedir(), '.local', 'bin'))
    expect(entries).toContain(join(homedir(), '.volta', 'bin'))
    expect(entries).toContain('/usr/local/bin')
    if (process.platform === 'darwin') {
      expect(entries).toContain(join(homedir(), 'Library', 'pnpm'))
      expect(entries).toContain('/opt/homebrew/bin')
    }
  })

  it('uses the npm-compatible PATH for safe child process environments', () => {
    vi.stubEnv('PATH', MINIMAL_PATH)

    const childEnv = getSafeChildEnv()
    const entries = pathEntries(childEnv.PATH)

    expect(entries).toContain(join(homedir(), '.local', 'bin'))
    expect(entries).toContain('/usr/local/bin')
  })

  it('preserves existing PATH precedence before npm-compatible fallbacks', () => {
    const existingEntries = ['/custom/shims', '/usr/bin', '/bin']
    vi.stubEnv('PATH', existingEntries.join(delimiter))

    const entries = pathEntries(getSafeChildEnv().PATH)

    expect(entries.slice(0, existingEntries.length)).toEqual(existingEntries)
    expect(entries).toContain(join(homedir(), '.local', 'bin'))
    expect(entries).toContain('/usr/local/bin')
  })

  it('passes only Windows runtime paths to the pipe security helper', () => {
    vi.stubEnv('SystemRoot', 'C:\\Windows')
    vi.stubEnv('TEMP', 'C:\\Users\\person\\Temp')
    vi.stubEnv('USERPROFILE', 'C:\\Users\\person')
    vi.stubEnv('OPENAI_API_KEY', 'provider-secret')

    expect(getWindowsSecurityChildEnv()).toMatchObject({
      SystemRoot: 'C:\\Windows',
      TEMP: 'C:\\Users\\person\\Temp',
      USERPROFILE: 'C:\\Users\\person',
    })
    expect(getWindowsSecurityChildEnv()).not.toHaveProperty('OPENAI_API_KEY')
  })

  it('preserves provider and shell-agent state for a detached Host without client authority', () => {
    vi.stubEnv('OPENAI_API_KEY', 'provider-secret')
    vi.stubEnv('CUSTOM_PROVIDER_TOKEN', 'custom-secret')
    vi.stubEnv('SSH_AUTH_SOCK', '/tmp/ssh-agent.sock')
    vi.stubEnv('OPENWAGGLE_PROFILE_CREDENTIAL_FILE', '/tmp/profile-credential')
    vi.stubEnv('OPENWAGGLE_CLI_OUTPUT_FD', '3')
    vi.stubEnv('ELECTRON_RUN_AS_NODE', '1')

    expect(getSessionHostChildEnv()).toMatchObject({
      OPENAI_API_KEY: 'provider-secret',
      CUSTOM_PROVIDER_TOKEN: 'custom-secret',
      SSH_AUTH_SOCK: '/tmp/ssh-agent.sock',
    })
    expect(getSessionHostChildEnv()).not.toHaveProperty('OPENWAGGLE_PROFILE_CREDENTIAL_FILE')
    expect(getSessionHostChildEnv()).not.toHaveProperty('OPENWAGGLE_CLI_OUTPUT_FD')
    expect(getSessionHostChildEnv()).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
  })

  it('passes only required desktop-session variables to browser credential helpers', () => {
    vi.stubEnv('DBUS_SESSION_BUS_ADDRESS', 'unix:path=/run/user/1000/bus')
    vi.stubEnv('XDG_RUNTIME_DIR', '/run/user/1000')
    vi.stubEnv('WAYLAND_DISPLAY', 'wayland-1')
    vi.stubEnv('SystemRoot', 'C:\\Windows')
    vi.stubEnv('BROWSER_IMPORT_SECRET_CANARY', 'do-not-leak')

    const childEnv = getBrowserCredentialChildEnv()

    expect(childEnv).toMatchObject({
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
      XDG_RUNTIME_DIR: '/run/user/1000',
      WAYLAND_DISPLAY: 'wayland-1',
      SystemRoot: 'C:\\Windows',
    })
    expect(childEnv.BROWSER_IMPORT_SECRET_CANARY).toBeUndefined()
  })

  it('reads the Windows browser profile roots without exposing unrelated environment values', () => {
    vi.stubEnv('APPDATA', 'D:\\Profiles\\Roaming')
    vi.stubEnv('LOCALAPPDATA', 'D:\\Profiles\\Local')
    vi.stubEnv('BROWSER_IMPORT_SECRET_CANARY', 'do-not-leak')

    expect(getBrowserImportPathEnv()).toEqual({
      appData: 'D:\\Profiles\\Roaming',
      localAppData: 'D:\\Profiles\\Local',
    })
  })

  it('preserves and augments PATH for interactive terminals', () => {
    const existingEntries = ['/custom/shims', '/custom/bin', '/usr/bin', '/bin']
    vi.stubEnv('PATH', existingEntries.join(delimiter))

    const entries = pathEntries(getInteractiveTerminalEnv(TEST_APP_VERSION).PATH)

    expect(entries.slice(0, existingEntries.length)).toEqual(existingEntries)
    expect(entries).toContain(join(homedir(), '.local', 'bin'))
  })

  it('preserves the full user environment needed by interactive terminal tools', () => {
    vi.stubEnv('LC_ALL', 'en_GB.UTF-8')
    vi.stubEnv('SSH_AUTH_SOCK', '/tmp/agent.sock')
    vi.stubEnv('DISPLAY', ':1')
    vi.stubEnv('WAYLAND_DISPLAY', 'wayland-1')
    vi.stubEnv('XDG_RUNTIME_DIR', '/run/user/1000')
    vi.stubEnv('HTTPS_PROXY', 'http://proxy.example')
    vi.stubEnv('NVM_BIN', '/home/user/.nvm/bin')
    vi.stubEnv('CUSTOM_TOOLCHAIN_ROOT', '/opt/toolchain')
    vi.stubEnv('EMPTY_TERMINAL_SETTING', '')

    const terminalEnv = getInteractiveTerminalEnv(TEST_APP_VERSION)

    expect(terminalEnv).toMatchObject({
      LC_ALL: 'en_GB.UTF-8',
      SSH_AUTH_SOCK: '/tmp/agent.sock',
      DISPLAY: ':1',
      WAYLAND_DISPLAY: 'wayland-1',
      XDG_RUNTIME_DIR: '/run/user/1000',
      HTTPS_PROXY: 'http://proxy.example',
      NVM_BIN: '/home/user/.nvm/bin',
      CUSTOM_TOOLCHAIN_ROOT: '/opt/toolchain',
      EMPTY_TERMINAL_SETTING: '',
    })
  })

  it('removes app controls and known Node injection controls from terminals', () => {
    vi.stubEnv('OPENWAGGLE_AUTOMATION', '1')
    vi.stubEnv('openwaggle_private_control', 'secret')
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
    vi.stubEnv('ELECTRON_RUN_AS_NODE', '1')
    vi.stubEnv('NODE_OPTIONS', '--require /tmp/injected.cjs')
    vi.stubEnv('NODE_PATH', '/tmp/injected-modules')
    vi.stubEnv('NODE_REPL_EXTERNAL_MODULE', '/tmp/injected-repl.cjs')
    vi.stubEnv('NODE_ENV', 'development')

    const terminalEnv = getInteractiveTerminalEnv(TEST_APP_VERSION)

    expect(terminalEnv.OPENWAGGLE_AUTOMATION).toBeUndefined()
    expect(terminalEnv.openwaggle_private_control).toBeUndefined()
    expect(terminalEnv.ELECTRON_RENDERER_URL).toBeUndefined()
    expect(terminalEnv.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(terminalEnv.NODE_OPTIONS).toBeUndefined()
    expect(terminalEnv.NODE_PATH).toBeUndefined()
    expect(terminalEnv.NODE_REPL_EXTERNAL_MODULE).toBeUndefined()
    expect(terminalEnv.NODE_ENV).toBe('development')
  })

  it('takes a fresh environment snapshot for every terminal spawn', () => {
    vi.stubEnv('OPENWAGGLE_FRESHNESS_CANARY_USER', 'first')
    const first = getInteractiveTerminalEnv(TEST_APP_VERSION)

    vi.stubEnv('OPENWAGGLE_FRESHNESS_CANARY_USER', 'second')
    const second = getInteractiveTerminalEnv(TEST_APP_VERSION)

    expect(first.OPENWAGGLE_FRESHNESS_CANARY_USER).toBeUndefined()
    expect(second.OPENWAGGLE_FRESHNESS_CANARY_USER).toBeUndefined()

    vi.stubEnv('TERMINAL_FRESHNESS_CANARY', 'first')
    const inheritedFirst = getInteractiveTerminalEnv(TEST_APP_VERSION)
    vi.stubEnv('TERMINAL_FRESHNESS_CANARY', 'second')
    const inheritedSecond = getInteractiveTerminalEnv(TEST_APP_VERSION)

    expect(inheritedFirst.TERMINAL_FRESHNESS_CANARY).toBe('first')
    expect(inheritedSecond.TERMINAL_FRESHNESS_CANARY).toBe('second')
  })

  it('advertises OpenWaggle and true-color terminal capabilities', () => {
    vi.stubEnv('TERM', 'dumb')
    vi.stubEnv('COLORTERM', 'legacy')
    vi.stubEnv('TERM_PROGRAM', 'OtherTerminal')
    vi.stubEnv('TERM_PROGRAM_VERSION', '0')

    const terminalEnv = getInteractiveTerminalEnv(TEST_APP_VERSION)

    expect(terminalEnv.TERM).toBe('xterm-256color')
    expect(terminalEnv.COLORTERM).toBe('truecolor')
    expect(terminalEnv.TERM_PROGRAM).toBe('OpenWaggle')
    expect(terminalEnv.TERM_PROGRAM_VERSION).toBe(TEST_APP_VERSION)
  })

  it('layers explicit launch overrides over a fresh inferred environment', () => {
    vi.stubEnv('PATH', MINIMAL_PATH)
    vi.stubEnv('SHELL', '/bin/zsh')
    vi.stubEnv('T3CODE_PROJECT_ROOT', '/stale/project')

    const terminalEnv = getInteractiveTerminalEnv(TEST_APP_VERSION, {
      T3CODE_PROJECT_ROOT: '/current/project',
      OPENWAGGLE_PROJECT_ROOT: '/current/project',
    })

    expect(terminalEnv).toMatchObject({
      SHELL: '/bin/zsh',
      T3CODE_PROJECT_ROOT: '/current/project',
      OPENWAGGLE_PROJECT_ROOT: '/current/project',
    })
    expect(pathEntries(terminalEnv.PATH)).toContain('/usr/bin')
  })

  it('replaces stale parent T3 context and keeps worktree variables out of Local actions', () => {
    vi.stubEnv('T3CODE_PROJECT_ROOT', '/stale/project')
    vi.stubEnv('T3CODE_WORKTREE_PATH', '/stale/worktree')

    const normalTerminalEnv = getInteractiveTerminalEnv(TEST_APP_VERSION)
    const terminalEnv = getInteractiveTerminalEnv(
      TEST_APP_VERSION,
      createProjectActionTerminalEnvironment({ projectRoot: '/current/project' }),
    )

    expect(normalTerminalEnv.T3CODE_PROJECT_ROOT).toBeUndefined()
    expect(normalTerminalEnv.T3CODE_WORKTREE_PATH).toBeUndefined()
    expect(terminalEnv.T3CODE_PROJECT_ROOT).toBe('/current/project')
    expect(terminalEnv.OPENWAGGLE_PROJECT_ROOT).toBe('/current/project')
    expect(terminalEnv.T3CODE_WORKTREE_PATH).toBeUndefined()
    expect(terminalEnv.OPENWAGGLE_WORKTREE_PATH).toBeUndefined()
  })

  it('strips AppImage runtime markers and mounted paths without losing host paths', () => {
    const appDir = '/tmp/.mount_OpenWaggle123'
    vi.stubEnv('APPIMAGE', '/home/user/OpenWaggle.AppImage')
    vi.stubEnv('APPDIR', appDir)
    vi.stubEnv('ARGV0', '/home/user/OpenWaggle.AppImage')
    vi.stubEnv('OWD', '/home/user/project')
    vi.stubEnv('PATH', `${appDir}/usr/bin:${appDir}:/usr/local/bin:/usr/bin:/bin`)
    vi.stubEnv('LD_LIBRARY_PATH', `${appDir}/usr/lib:/home/user/.local/lib`)
    vi.stubEnv('XDG_DATA_DIRS', `${appDir}/usr/share:/usr/local/share:/usr/share`)
    vi.stubEnv('GSETTINGS_SCHEMA_DIR', `${appDir}/usr/share/glib-2.0/schemas`)

    const terminalEnv = getInteractiveTerminalEnv(TEST_APP_VERSION)

    expect(terminalEnv.APPIMAGE).toBeUndefined()
    expect(terminalEnv.APPDIR).toBeUndefined()
    expect(terminalEnv.ARGV0).toBeUndefined()
    expect(terminalEnv.OWD).toBeUndefined()
    expect(terminalEnv.PATH).not.toContain(appDir)
    expect(terminalEnv.PATH).toContain('/usr/local/bin')
    expect(terminalEnv.LD_LIBRARY_PATH).toBe('/home/user/.local/lib')
    expect(terminalEnv.XDG_DATA_DIRS).toBe('/usr/local/share:/usr/share')
    expect(terminalEnv.GSETTINGS_SCHEMA_DIR).toBeUndefined()
  })

  it('keeps ordinary OWD when the app was not launched from an AppImage', () => {
    vi.stubEnv('APPIMAGE', undefined)
    vi.stubEnv('APPDIR', undefined)
    vi.stubEnv('OWD', '/home/user/keep-this')

    expect(getInteractiveTerminalEnv(TEST_APP_VERSION).OWD).toBe('/home/user/keep-this')
  })
})
