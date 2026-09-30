import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareScratchDirectory } from '../pi-agent-kernel-launch'

const mocks = vi.hoisted(() => ({
  prepareScratch: vi.fn(),
  prepareEvidence: vi.fn(),
}))

vi.mock('../../../utils/session-scratch-directory', () => ({
  prepareSessionScratchDirectory: mocks.prepareScratch,
}))
vi.mock('../../../utils/session-evidence-directory', () => ({
  prepareSessionEvidenceDirectory: mocks.prepareEvidence,
}))

const SCRATCH = '/tmp/ow-scratch-501/37a8eec1/0123456789ab'

describe('prepareScratchDirectory', () => {
  beforeEach(() => {
    mocks.prepareScratch.mockReset().mockResolvedValue(SCRATCH)
    mocks.prepareEvidence.mockReset().mockResolvedValue('/tmp/ow-scratch-501/evidence/0123456789ab')
  })

  it('lets the turn run with the Host temp directory when the directory cannot be made', async () => {
    mocks.prepareScratch.mockRejectedValue(
      Object.assign(new Error('Scratch directory is owned by another user'), { code: 'EPERM' }),
    )

    await expect(
      Effect.runPromise(prepareScratchDirectory(SessionId('session-blocked'))),
    ).resolves.toBeUndefined()
  })

  it("prepares the Session's evidence directory alongside its scratch directory", async () => {
    await expect(Effect.runPromise(prepareScratchDirectory(SessionId('session')))).resolves.toBe(
      SCRATCH,
    )
    expect(mocks.prepareEvidence).toHaveBeenCalledWith(SCRATCH)
  })

  it('keeps the scratch directory when the evidence directory cannot be made', async () => {
    mocks.prepareEvidence.mockRejectedValue(new Error('evidence root is a symlink'))

    await expect(Effect.runPromise(prepareScratchDirectory(SessionId('session')))).resolves.toBe(
      SCRATCH,
    )
  })
})
