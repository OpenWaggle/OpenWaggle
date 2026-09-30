import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import { prepareScratchDirectory } from '../pi-agent-kernel-launch'

vi.mock('../../../utils/session-scratch-directory', () => ({
  prepareSessionScratchDirectory: async () => {
    throw Object.assign(new Error('Scratch directory is owned by another user'), { code: 'EPERM' })
  },
}))

describe('prepareScratchDirectory', () => {
  it('lets the turn run with the Host temp directory when the directory cannot be made', async () => {
    await expect(
      Effect.runPromise(prepareScratchDirectory(SessionId('session-blocked'))),
    ).resolves.toBeUndefined()
  })
})
