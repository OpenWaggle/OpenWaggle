import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { createProjectActionTerminalEnvironment } from '@shared/utils/terminal-environment'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  env,
  getBrowserCredentialChildEnv,
  getBrowserImportPathEnv,
  getInteractiveTerminalEnv,
  getNpmCompatiblePath,
  getSafeChildEnv,
  getSessionHostChildEnv,
  getWindowsSecurityChildEnv,
  restoreHostTemporaryDirectory,
  takeShellEnvironmentRefreshedSince,
} from '../env'

const MINIMAL_PATH = ['/usr/bin', '/bin'].join(delimiter)
const TEST_APP_VERSION = '1.2.3-test'

const childPathSchema = Schema.Struct({ PATH: Schema.optionalWith(Schema.String, { exact: true }) })

/** The PATH entries of a child environment map, decoded rather than read out of the map. */
function pathEntries(environment: Readonly<Record<string, string | undefined>>) {
  return decodeUnknownOrThrow(childPathSchema, environment).PATH?.split(delimiter) ?? []
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('main process environment helpers', () => {
  it('moves an OpenWaggle process started from an agent shell back to the Host temp dir', () => {
    const scratch = '/tmp/ow-scratch-501/37a8eec1/41437e3fd25b'
    const environment = { TMPDIR: scratch, TMP: scratch, TEMP: scratch, KEEP: 'value' }

    restoreHostTemporaryDirectory(environment, '/var/folders/host/T')

    expect(environment).toEqual({
      TMPDIR: '/var/folders/host/T',
      TMP: '/var/folders/host/T',
      TEMP: '/var/folders/host/T',
      KEEP: 'value',
    })
  })

  it('leaves the temp directory alone when no Host temp directory is known', () => {
    // An agent shell exports OPENWAGGLE_HOST_TMPDIR; this test needs the no-Host case, so it
    // drives the parsed env object directly rather than the ambient shell, and puts the value
    // back afterwards. The parsed env is readonly-typed, hence Object.assign over assignment.
    const previous = env.OPENWAGGLE_HOST_TMPDIR
    Object.assign(env, { OPENWAGGLE_HOST_TMPDIR: undefined })
    try {
      const environment = { TMPDIR: '/var/folders/user/T' }

      restoreHostTemporaryDirectory(environment)

      expect(environment).toEqual({ TMPDIR: '/var/folders/user/T' })
    } finally {
      Object.assign(env, { OPENWAGGLE_HOST_TMPDIR: previous })
    }
  })

  it('adds common user tool directories to the npm-compatible PATH', () => {
    vi.stubEnv('PATH', MINIMAL_PATH)

    const entries = getNpmCompatiblePath().split(delimiter)

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
    const entries = pathEntries(childEnv)

    expect(entries).toContain(join(homedir(), '.local', 'bin'))
    expect(entries).toContain('/usr/local/bin')
  })

  it('preserves existing PATH precedence before npm-compatible fallbacks', () => {
    const existingEntries = ['/custom/shims', '/usr/bin', '/bin']
    vi.stubEnv('PATH', existingEntries.join(delimiter))

    const entries = pathEntries(getSafeChildEnv())

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

  it("takes the launching app's login-shell refresh time out of a Host's environment", () => {
    vi.stubEnv('OPENWAGGLE_SHELL_ENVIRONMENT_REFRESHED_SINCE', '1800000000000')
    // A Host this process launches gets its own value, never one this process inherited.
    expect(getSessionHostChildEnv()).not.toHaveProperty(
      'OPENWAGGLE_SHELL_ENVIRONMENT_REFRESHED_SINCE',
    )

    expect(takeShellEnvironmentRefreshedSince()).toBe(1_800_000_000_000)
    // Taken once: it is gone from this process's environment.
    expect(takeShellEnvironmentRefreshedSince()).toBeUndefined()
    vi.stubEnv('OPENWAGGLE_SHELL_ENVIRONMENT_REFRESHED_SINCE', 'soon')
    expect(takeShellEnvironmentRefreshedSince()).toBeUndefined()
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
    expect(childEnv).not.toHaveProperty('BROWSER_IMPORT_SECRET_CANARY')
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

    const entries = pathEntries(getInteractiveTerminalEnv(TEST_APP_VERSION))

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

    expect(terminalEnv).not.toHaveProperty('OPENWAGGLE_AUTOMATION')
    expect(terminalEnv).not.toHaveProperty('openwaggle_private_control')
    expect(terminalEnv).not.toHaveProperty('ELECTRON_RENDERER_URL')
    expect(terminalEnv).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
    expect(terminalEnv).not.toHaveProperty('NODE_OPTIONS')
    expect(terminalEnv).not.toHaveProperty('NODE_PATH')
    expect(terminalEnv).not.toHaveProperty('NODE_REPL_EXTERNAL_MODULE')
    expect(terminalEnv).toHaveProperty('NODE_ENV', 'development')
  })

  it('takes a fresh environment snapshot for every terminal spawn', () => {
    vi.stubEnv('OPENWAGGLE_FRESHNESS_CANARY_USER', 'first')
    const first = getInteractiveTerminalEnv(TEST_APP_VERSION)

    vi.stubEnv('OPENWAGGLE_FRESHNESS_CANARY_USER', 'second')
    const second = getInteractiveTerminalEnv(TEST_APP_VERSION)

    expect(first).not.toHaveProperty('OPENWAGGLE_FRESHNESS_CANARY_USER')
    expect(second).not.toHaveProperty('OPENWAGGLE_FRESHNESS_CANARY_USER')

    vi.stubEnv('TERMINAL_FRESHNESS_CANARY', 'first')
    const inheritedFirst = getInteractiveTerminalEnv(TEST_APP_VERSION)
    vi.stubEnv('TERMINAL_FRESHNESS_CANARY', 'second')
    const inheritedSecond = getInteractiveTerminalEnv(TEST_APP_VERSION)

    expect(inheritedFirst).toHaveProperty('TERMINAL_FRESHNESS_CANARY', 'first')
    expect(inheritedSecond).toHaveProperty('TERMINAL_FRESHNESS_CANARY', 'second')
  })

  it('advertises OpenWaggle and true-color terminal capabilities', () => {
    vi.stubEnv('TERM', 'dumb')
    vi.stubEnv('COLORTERM', 'legacy')
    vi.stubEnv('TERM_PROGRAM', 'OtherTerminal')
    vi.stubEnv('TERM_PROGRAM_VERSION', '0')

    const terminalEnv = getInteractiveTerminalEnv(TEST_APP_VERSION)

    expect(terminalEnv).toHaveProperty('TERM', 'xterm-256color')
    expect(terminalEnv).toHaveProperty('COLORTERM', 'truecolor')
    expect(terminalEnv).toHaveProperty('TERM_PROGRAM', 'OpenWaggle')
    expect(terminalEnv).toHaveProperty('TERM_PROGRAM_VERSION', TEST_APP_VERSION)
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
      OPENWAGGLE_PROJECT_ROOT: '/current/project',
    })
    expect(terminalEnv).not.toHaveProperty('T3CODE_PROJECT_ROOT')
    expect(pathEntries(terminalEnv)).toContain('/usr/bin')
  })

  it('removes legacy vendor aliases and keeps worktree variables out of Local actions', () => {
    vi.stubEnv('T3CODE_PROJECT_ROOT', '/stale/project')
    vi.stubEnv('T3CODE_WORKTREE_PATH', '/stale/worktree')

    const normalTerminalEnv = getInteractiveTerminalEnv(TEST_APP_VERSION)
    const terminalEnv = getInteractiveTerminalEnv(
      TEST_APP_VERSION,
      createProjectActionTerminalEnvironment({ projectRoot: '/current/project' }),
    )

    expect(normalTerminalEnv).not.toHaveProperty('T3CODE_PROJECT_ROOT')
    expect(normalTerminalEnv).not.toHaveProperty('T3CODE_WORKTREE_PATH')
    expect(terminalEnv).not.toHaveProperty('T3CODE_PROJECT_ROOT')
    expect(terminalEnv).toHaveProperty('OPENWAGGLE_PROJECT_ROOT', '/current/project')
    expect(terminalEnv).not.toHaveProperty('T3CODE_WORKTREE_PATH')
    expect(terminalEnv).not.toHaveProperty('OPENWAGGLE_WORKTREE_PATH')
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

    expect(terminalEnv).not.toHaveProperty('APPIMAGE')
    expect(terminalEnv).not.toHaveProperty('APPDIR')
    expect(terminalEnv).not.toHaveProperty('ARGV0')
    expect(terminalEnv).not.toHaveProperty('OWD')
    expect(pathEntries(terminalEnv).filter((entry) => entry.startsWith(appDir))).toEqual([])
    expect(pathEntries(terminalEnv)).toContain('/usr/local/bin')
    expect(terminalEnv).toHaveProperty('LD_LIBRARY_PATH', '/home/user/.local/lib')
    expect(terminalEnv).toHaveProperty('XDG_DATA_DIRS', '/usr/local/share:/usr/share')
    expect(terminalEnv).not.toHaveProperty('GSETTINGS_SCHEMA_DIR')
  })

  it('keeps ordinary OWD when the app was not launched from an AppImage', () => {
    vi.stubEnv('APPIMAGE', undefined)
    vi.stubEnv('APPDIR', undefined)
    vi.stubEnv('OWD', '/home/user/keep-this')

    expect(getInteractiveTerminalEnv(TEST_APP_VERSION)).toHaveProperty(
      'OWD',
      '/home/user/keep-this',
    )
  })
})
