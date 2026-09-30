import os from 'node:os'
import { describe, expect, it } from 'vitest'
import { qaSharedTemporaryDirectory } from '../electron-qa-lease'

describe('Electron QA lease location', () => {
  it('keeps the port lease in the Host temp directory shared by every Session', () => {
    // An agent shell's TMPDIR is its own Session scratch directory; a lease there would let two
    // Sessions both believe they hold the QA port.
    expect(
      qaSharedTemporaryDirectory({
        TMPDIR: '/tmp/ow-scratch-501/37a8eec1/0123456789ab',
        OPENWAGGLE_HOST_TMPDIR: '/var/folders/host/T',
      }),
    ).toBe('/var/folders/host/T')
  })

  it('uses the ordinary temp directory outside an agent shell', () => {
    expect(qaSharedTemporaryDirectory({})).toBe(os.tmpdir())
  })
})
