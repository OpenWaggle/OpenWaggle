import { describe, expect, it } from 'vitest'
import { terminalExitProofIsComplete } from '../terminal-process-control'

describe('terminal exit proof', () => {
  it('uses the native Windows Job-empty event as the termination proof', () => {
    const proof = {
      platform: 'win32' as const,
      rootExited: true,
      processSnapshotReliable: false,
      descendantsExited: false,
    }

    expect(terminalExitProofIsComplete(proof)).toBe(true)
    expect(
      terminalExitProofIsComplete({
        ...proof,
        rootExited: false,
      }),
    ).toBe(false)
  })

  it('requires POSIX root, descendants, and reliable identity evidence together', () => {
    const proof = {
      platform: 'darwin' as const,
      rootExited: true,
      descendantsExited: true,
      processSnapshotReliable: true,
    }
    expect(terminalExitProofIsComplete(proof)).toBe(true)
    for (const field of ['rootExited', 'descendantsExited', 'processSnapshotReliable'] as const) {
      expect(terminalExitProofIsComplete({ ...proof, [field]: false })).toBe(false)
    }
  })
})
