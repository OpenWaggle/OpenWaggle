import { SessionId } from '@shared/types/brand'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listTurnDiffFiles = vi.fn()
vi.mock('@/shared/lib/ipc', () => ({
  api: { listTurnDiffFiles: (...args: unknown[]) => listTurnDiffFiles(...args) },
}))

const { readTurnDiffFiles } = await import('../turn-checkpoints')

describe('readTurnDiffFiles (B5)', () => {
  beforeEach(() => {
    listTurnDiffFiles.mockReset()
  })

  it('reads every turn asked for in the same task in one call', async () => {
    const files = [{ path: 'a.ts', additions: 1, deletions: 0 }]
    listTurnDiffFiles.mockResolvedValue({ t1: files, t2: [] })
    const session = SessionId('session-1')

    const results = await Promise.all([
      readTurnDiffFiles(session, 't1'),
      readTurnDiffFiles(session, 't2'),
      readTurnDiffFiles(session, 't1'),
    ])

    expect(listTurnDiffFiles).toHaveBeenCalledTimes(1)
    expect(listTurnDiffFiles).toHaveBeenCalledWith(session, ['t1', 't2'])
    expect(results).toEqual([files, [], files])
  })

  it('reads each Session separately and rejects every waiter when the read fails', async () => {
    listTurnDiffFiles.mockRejectedValue(new Error('down'))

    const reads = [readTurnDiffFiles(SessionId('a'), 't1'), readTurnDiffFiles(SessionId('b'), 't1')]

    await expect(Promise.allSettled(reads)).resolves.toEqual([
      { status: 'rejected', reason: new Error('down') },
      { status: 'rejected', reason: new Error('down') },
    ])
    expect(listTurnDiffFiles).toHaveBeenCalledTimes(2)
  })
})
