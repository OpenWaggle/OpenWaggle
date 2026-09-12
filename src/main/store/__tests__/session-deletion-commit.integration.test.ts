import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import {
  createSession,
  deleteSession,
  establishSessionLineage,
  getSessionDetail,
  persistSessionSnapshot,
  setSessionDelegationState,
} from '../session-details'
import * as sessionFileDeletion from '../session-details/file-deletion'

const state = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => state.userDataDir },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

beforeEach(async () => {
  state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-session-delete-commit-'))
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  vi.restoreAllMocks()
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await fs.rm(state.userDataDir, { recursive: true, force: true })
})

function createTestSession(piSessionId: string) {
  return createSession({ projectPath: state.userDataDir, piSessionId })
}

describe('session deletion commit boundary', () => {
  it.each(['working', 'waiting'] as const)(
    'preserves runtime ownership when a Worker becomes %s during file staging',
    async (delegationState) => {
      const queen = await createTestSession('queen')
      const worker = await createTestSession('worker')
      await establishSessionLineage({
        sessionId: worker.id,
        parentSessionId: queen.id,
        agentDefinitionName: 'worker',
        delegationState: 'accepted',
      })
      const onCommitted = vi.fn()
      const restore = vi.fn(async () => undefined)
      const cleanup = vi.fn(async () => undefined)
      vi.spyOn(sessionFileDeletion, 'stageSessionFileDeletion').mockImplementationOnce(async () => {
        await setSessionDelegationState(worker.id, delegationState)
        return { restore, cleanup }
      })
      const { runAppEffect } = await import('../../runtime')

      await expect(
        runAppEffect(
          Effect.gen(function* () {
            const repo = yield* SessionProjectionRepository
            yield* repo.delete(worker.id, onCommitted)
          }),
        ),
      ).rejects.toThrow()

      expect(onCommitted).not.toHaveBeenCalled()
      expect(restore).toHaveBeenCalledOnce()
      expect(cleanup).not.toHaveBeenCalled()
      expect(await getSessionDetail(worker.id)).not.toBeNull()
    },
  )

  it('keeps a Queen alive when a new Worker is attached during file staging', async () => {
    const queen = await createTestSession('new-queen')
    const worker = await createTestSession('new-worker')
    const onCommitted = vi.fn()
    const restore = vi.fn(async () => undefined)
    const cleanup = vi.fn(async () => undefined)
    vi.spyOn(sessionFileDeletion, 'stageSessionFileDeletion').mockImplementationOnce(async () => {
      await establishSessionLineage({
        sessionId: worker.id,
        parentSessionId: queen.id,
        agentDefinitionName: 'late-worker',
        delegationState: 'working',
      })
      return { restore, cleanup }
    })
    await expect(deleteSession(queen.id, onCommitted)).rejects.toThrow()
    expect(onCommitted).not.toHaveBeenCalled()
    expect(restore).toHaveBeenCalledOnce()
    expect(cleanup).not.toHaveBeenCalled()
    expect(await getSessionDetail(queen.id)).not.toBeNull()
  })

  it('runs committed runtime cleanup before file cleanup and survives its failure', async () => {
    const session = await createTestSession('delete-committed')
    const onCommitted = vi.fn()
    const persistedAtCleanup = vi.fn()
    const restore = vi.fn(async () => undefined)
    const cleanup = vi.fn(async () => {
      persistedAtCleanup(await getSessionDetail(session.id))
      throw new Error('Tombstone is temporarily locked')
    })
    vi.spyOn(sessionFileDeletion, 'stageSessionFileDeletion').mockResolvedValueOnce({
      cleanup,
      restore,
    })
    const { runAppEffect } = await import('../../runtime')

    await expect(
      runAppEffect(
        Effect.gen(function* () {
          const repo = yield* SessionProjectionRepository
          yield* repo.delete(session.id, onCommitted)
        }),
      ),
    ).resolves.toBeUndefined()

    expect(cleanup).toHaveBeenCalledOnce()
    expect(onCommitted).toHaveBeenCalledOnce()
    expect(onCommitted.mock.invocationCallOrder[0]).toBeLessThan(
      cleanup.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )
    expect(persistedAtCleanup).toHaveBeenCalledWith(null)
    expect(restore).not.toHaveBeenCalled()
    expect(await getSessionDetail(session.id)).toBeNull()
  })

  it('does not roll back committed deletion when runtime cleanup throws', async () => {
    const session = await createTestSession('delete-callback-error')
    const restore = vi.fn(async () => undefined)
    const cleanup = vi.fn(async () => undefined)
    vi.spyOn(sessionFileDeletion, 'stageSessionFileDeletion').mockResolvedValueOnce({
      cleanup,
      restore,
    })
    await expect(
      deleteSession(session.id, () => {
        throw new Error('Runtime cleanup failed')
      }),
    ).resolves.toBeUndefined()
    expect(cleanup).toHaveBeenCalledOnce()
    expect(restore).not.toHaveBeenCalled()
    expect(await getSessionDetail(session.id)).toBeNull()
  })

  it('cannot resurrect a deleted Session through late snapshots or lineage writes', async () => {
    const queen = await createTestSession('deleted-queen')
    const worker = await createTestSession('surviving-worker')
    await deleteSession(queen.id)

    await expect(
      persistSessionSnapshot({
        sessionId: queen.id,
        piSessionId: 'deleted-queen',
        activeNodeId: null,
        nodes: [],
      }),
    ).rejects.toThrow()
    await expect(
      establishSessionLineage({
        sessionId: worker.id,
        parentSessionId: queen.id,
        agentDefinitionName: 'late-worker',
        delegationState: 'working',
      }),
    ).rejects.toThrow()
    expect(await getSessionDetail(queen.id)).toBeNull()
    expect(await getSessionDetail(worker.id)).not.toBeNull()
  })
})
