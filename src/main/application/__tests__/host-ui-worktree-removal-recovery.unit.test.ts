import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionWorkspaceResourceRepository } from '../../ports/session-workspace-resource-repository'

vi.mock('../../services/git-status-cache', () => ({
  invalidateGitStatusCache: vi.fn(),
}))

import { recoverPendingManagedWorktreeRemovals } from '../host-ui-worktree-operation'

const finalizeRemoval = vi.fn()

function recover(pending: Parameters<typeof recoverPendingManagedWorktreeRemovals>[0]) {
  return Effect.runPromise(
    recoverPendingManagedWorktreeRemovals(pending).pipe(
      Effect.provideService(
        SessionWorkspaceResourceRepository,
        fromPartial<SessionWorkspaceResourceRepository['Type']>({
          finalizeManagedWorktreeRemoval: (finalization: unknown) =>
            Effect.sync(() => finalizeRemoval(finalization)),
        }),
      ),
    ),
  )
}

describe('Worktree removals the Host lost', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    finalizeRemoval.mockReset()
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-worktree-recovery-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('reconciles tracked and synthetic removal reservations after Host loss', async () => {
    const survivingPath = path.join(temporaryRoot, 'surviving')
    await fs.mkdir(survivingPath)

    await recover([
      { resourceId: 'tracked-surviving', workingPath: survivingPath, createdReservation: false },
      {
        resourceId: 'tracked-removed',
        workingPath: path.join(temporaryRoot, 'missing'),
        createdReservation: false,
      },
      {
        resourceId: 'worktree-removal:synthetic',
        workingPath: survivingPath,
        createdReservation: true,
      },
    ])

    expect(finalizeRemoval.mock.calls.map((call) => call[0])).toEqual([
      { resourceId: 'tracked-surviving', createdReservation: false, removed: false },
      { resourceId: 'tracked-removed', createdReservation: false, removed: true },
      {
        resourceId: 'worktree-removal:synthetic',
        createdReservation: true,
        removed: false,
      },
    ])
  })

  it('leaves an uninspectable reservation fail-closed and continues recovery', async () => {
    const loopPath = path.join(temporaryRoot, 'symlink-loop')
    await fs.symlink(loopPath, loopPath)

    const results = await recover([
      { resourceId: 'tracked-loop', workingPath: loopPath, createdReservation: false },
      {
        resourceId: 'worktree-removal:synthetic',
        workingPath: loopPath,
        createdReservation: true,
      },
    ])

    expect(results.map((result) => result.outcome._tag)).toEqual(['Left', 'Right'])
    expect(finalizeRemoval).toHaveBeenCalledOnce()
    expect(finalizeRemoval).toHaveBeenCalledWith({
      resourceId: 'worktree-removal:synthetic',
      createdReservation: true,
      removed: false,
    })
  })
})
