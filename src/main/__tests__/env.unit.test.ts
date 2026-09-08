import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getNpmCompatiblePath, getSafeChildEnv, getSourceControlCliEnv } from '../env'

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

  it('makes user-installed gh and glab discoverable from a minimal GUI PATH', () => {
    vi.stubEnv('PATH', MINIMAL_PATH)
    vi.stubEnv('GH_TOKEN', 'must-not-leak')
    vi.stubEnv('GITHUB_TOKEN', 'must-not-leak')
    vi.stubEnv('GH_ENTERPRISE_TOKEN', 'must-not-leak')
    vi.stubEnv('GITHUB_ENTERPRISE_TOKEN', 'must-not-leak')
    vi.stubEnv('GITLAB_TOKEN', 'must-not-leak')
    vi.stubEnv('GITLAB_ACCESS_TOKEN', 'must-not-leak')
    vi.stubEnv('GITLAB_PRIVATE_TOKEN', 'must-not-leak')
    vi.stubEnv('OAUTH_TOKEN', 'must-not-leak')
    vi.stubEnv('CI_JOB_TOKEN', 'must-not-leak')
    vi.stubEnv('GH_REPO', 'attacker/wrong-repository')
    vi.stubEnv('GH_HOST', 'github.attacker.test')
    vi.stubEnv('GITLAB_REPO', 'attacker/wrong-repository')
    vi.stubEnv('GITLAB_HOST', 'gitlab.attacker.test')
    vi.stubEnv('GITLAB_API_HOST', 'api.gitlab.attacker.test')
    vi.stubEnv('GITLAB_SSH_HOST', 'ssh.gitlab.attacker.test')
    vi.stubEnv('GITLAB_HEAD_REPO', 'attacker/wrong-fork')
    vi.stubEnv('GITLAB_URI', 'https://gitlab.attacker.test')
    vi.stubEnv('GITLAB_URL', 'https://gitlab.attacker.test')
    vi.stubEnv('GLAB_REPO', 'attacker/another-repository')
    vi.stubEnv('GLAB_HOST', 'gitlab.another-attacker.test')

    const cliEnv = getSourceControlCliEnv()
    const entries = pathEntries(cliEnv.PATH)

    expect(entries).toContain(join(homedir(), '.local', 'bin'))
    expect(entries).toContain('/usr/local/bin')
    if (process.platform === 'darwin') expect(entries).toContain('/opt/homebrew/bin')
    expect(cliEnv.GH_TOKEN).toBeUndefined()
    expect(cliEnv.GITHUB_TOKEN).toBeUndefined()
    expect(cliEnv.GH_ENTERPRISE_TOKEN).toBeUndefined()
    expect(cliEnv.GITHUB_ENTERPRISE_TOKEN).toBeUndefined()
    expect(cliEnv.GITLAB_TOKEN).toBeUndefined()
    expect(cliEnv.GITLAB_ACCESS_TOKEN).toBeUndefined()
    expect(cliEnv.GITLAB_PRIVATE_TOKEN).toBeUndefined()
    expect(cliEnv.OAUTH_TOKEN).toBeUndefined()
    expect(cliEnv.CI_JOB_TOKEN).toBeUndefined()
    expect(cliEnv.GH_REPO).toBeUndefined()
    expect(cliEnv.GH_HOST).toBeUndefined()
    expect(cliEnv.GITLAB_REPO).toBeUndefined()
    expect(cliEnv.GITLAB_HOST).toBeUndefined()
    expect(cliEnv.GITLAB_API_HOST).toBeUndefined()
    expect(cliEnv.GITLAB_SSH_HOST).toBeUndefined()
    expect(cliEnv.GITLAB_HEAD_REPO).toBeUndefined()
    expect(cliEnv.GITLAB_URI).toBeUndefined()
    expect(cliEnv.GITLAB_URL).toBeUndefined()
    expect(cliEnv.GLAB_REPO).toBeUndefined()
    expect(cliEnv.GLAB_HOST).toBeUndefined()
  })
})
