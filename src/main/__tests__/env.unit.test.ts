import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getNpmCompatiblePath, getSafeChildEnv } from '../env'

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
})
