import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getNpmCompatiblePath,
  getSafeChildEnv,
  getSessionHostChildEnv,
  getWindowsSecurityChildEnv,
} from '../env'

const MINIMAL_PATH = ['/usr/bin', '/bin'].join(delimiter)

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
})
