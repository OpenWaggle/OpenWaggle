import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('Host temp directory restore at startup', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('moves the temp directory back to the Host temp directory when imported', async () => {
    vi.stubEnv('OPENWAGGLE_HOST_TMPDIR', '/var/folders/host/T')
    vi.stubEnv('TMPDIR', '/tmp/ow-scratch-501/37a8eec1/0123456789ab')
    vi.stubEnv('TMP', '/tmp/ow-scratch-501/37a8eec1/0123456789ab')
    vi.stubEnv('TEMP', '/tmp/ow-scratch-501/37a8eec1/0123456789ab')
    vi.resetModules()

    await import('../restore-host-temporary-directory')

    // `os.tmpdir()` reads TMPDIR on macOS and Linux and TEMP/TMP on Windows; the env unit tests
    // cover each variable, this checks that importing the module applies them.
    expect(os.tmpdir()).toBe('/var/folders/host/T')
  })

  it('runs in the main entry before any OpenWaggle module other than the build identity', async () => {
    const source = await fs.readFile(path.join(__dirname, '..', 'index.ts'), 'utf8')
    const localImports = [...source.matchAll(/(?:from |import )'(\.\/[^']+)'/g)].map(
      (match) => match[1],
    )

    expect(localImports.slice(0, 2)).toEqual([
      './apply-build-identity',
      './restore-host-temporary-directory',
    ])
  })
})
