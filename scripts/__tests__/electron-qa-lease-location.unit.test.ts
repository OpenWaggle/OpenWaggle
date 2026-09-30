import os from 'node:os'
import { describe, expect, it } from 'vitest'
import { isOwnedQaTemporaryPath, qaSharedTemporaryDirectory } from '../electron-qa-lease'

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

  it('recognizes a profile another Session created in the shared directory as recoverable', () => {
    const shared = '/var/folders/host/T'
    // Created by a launcher whose own TMPDIR was a different Session's scratch directory.
    expect(
      isOwnedQaTemporaryPath(`${shared}/openwaggle-qa-profile-abc`, 'openwaggle-qa-profile-', shared),
    ).toBe(true)
    expect(
      isOwnedQaTemporaryPath(
        '/tmp/ow-scratch-501/37a8eec1/0123456789ab/openwaggle-qa-profile-abc',
        'openwaggle-qa-profile-',
        shared,
      ),
    ).toBe(false)
  })
})
