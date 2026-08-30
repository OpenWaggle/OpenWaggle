import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionWorkspaceResourceRepository } from '../../ports/session-workspace-resource-repository'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  admitRemoval: vi.fn(),
  finalizeRemoval: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('../../adapters/git/worktree', () => ({
  createGitWorktree: mocks.create,
  removeGitWorktree: mocks.remove,
}))

vi.mock('../../services/git-status-cache', () => ({
  invalidateGitStatusCache: vi.fn(),
}))

import {
  createHostUiWorktree,
  recoverPendingManagedWorktreeRemovals,
  removeHostUiWorktree,
} from '../host-ui-worktree-operation'

function workspaceRepository(input: {
  readonly admission?: 'reserved' | 'unavailable'
  readonly boundWorkspace?: null
  readonly candidates?: readonly {
    readonly id: string
    readonly projectPath: string
    readonly workingPath: string
  }[]
}) {
  return SessionWorkspaceResourceRepository.of({
    countManagedWorktreeBindings: () => Effect.succeed(0),
    listManagedWorktreeRemovalCandidates: () => Effect.succeed(input.candidates ?? []),
    admitManagedWorktreeRemoval: (admissionInput) =>
      Effect.sync(() => {
        mocks.admitRemoval(admissionInput)
        return input.admission === 'unavailable'
          ? { status: 'unavailable' as const }
          : {
              status: 'reserved' as const,
              resourceId: 'removal-resource',
              createdReservation: true,
            }
      }),
    finalizeManagedWorktreeRemoval: (finalization) =>
      Effect.sync(() => mocks.finalizeRemoval(finalization)),
    getBound: () => Effect.succeed(input.boundWorkspace ?? null),
  })
}

describe('Host-backed worktree operations', () => {
  let temporaryRoot = ''

  beforeEach(() => {
    temporaryRoot = ''
    mocks.admitRemoval.mockReset()
    mocks.create.mockReset()
    mocks.finalizeRemoval.mockReset()
    mocks.remove.mockReset().mockResolvedValue({
      ok: true,
      path: '/project/.openwaggle/worktrees/free',
      message: 'Removed worktree.',
    })
  })

  afterEach(async () => {
    if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('rejects removal while an authoritative Workspace binding remains', async () => {
    const effect = removeHostUiWorktree('/project', {
      path: '/project/.openwaggle/worktrees/shared',
    }).pipe(
      Effect.provideService(
        SessionWorkspaceResourceRepository,
        workspaceRepository({ admission: 'unavailable' }),
      ),
    )

    await expect(Effect.runPromise(effect)).resolves.toEqual({
      ok: false,
      code: 'workspace-bound',
      message: 'This managed worktree is bound to a Session or is changing Workspace state.',
    })
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('removes an unbound worktree through the authoritative operation', async () => {
    const effect = removeHostUiWorktree('/project', {
      path: '/project/.openwaggle/worktrees/free',
    }).pipe(
      Effect.provideService(
        SessionWorkspaceResourceRepository,
        workspaceRepository({ admission: 'reserved' }),
      ),
    )

    await expect(Effect.runPromise(effect)).resolves.toEqual(expect.objectContaining({ ok: true }))
    expect(mocks.remove).toHaveBeenCalledWith('/project', {
      path: '/project/.openwaggle/worktrees/free',
    })
    expect(mocks.finalizeRemoval).toHaveBeenCalledWith({
      resourceId: 'removal-resource',
      createdReservation: true,
      removed: true,
    })
  })

  it('matches tracked worktrees through canonical filesystem identity', async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-worktree-alias-'))
    const projectPath = path.join(temporaryRoot, 'project')
    const worktreePath = path.join(temporaryRoot, 'worktree')
    const projectAlias = path.join(temporaryRoot, 'project-alias')
    const worktreeAlias = path.join(temporaryRoot, 'worktree-alias')
    await Promise.all([fs.mkdir(projectPath), fs.mkdir(worktreePath)])
    await Promise.all([
      fs.symlink(projectPath, projectAlias),
      fs.symlink(worktreePath, worktreeAlias),
    ])
    const effect = removeHostUiWorktree(projectAlias, { path: worktreeAlias }).pipe(
      Effect.provideService(
        SessionWorkspaceResourceRepository,
        workspaceRepository({
          admission: 'reserved',
          candidates: [{ id: 'tracked-resource', projectPath, workingPath: worktreePath }],
        }),
      ),
    )

    await expect(Effect.runPromise(effect)).resolves.toEqual(expect.objectContaining({ ok: true }))
    expect(mocks.admitRemoval).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'tracked-resource' }),
    )
  })

  it('waits for Git removal and finalizes its reservation when interrupted', async () => {
    let finishRemoval: (result: {
      readonly ok: true
      readonly path: string
      readonly message: string
    }) => void = () => undefined
    mocks.remove.mockReturnValue(
      new Promise((resolve) => {
        finishRemoval = resolve
      }),
    )
    const effect = removeHostUiWorktree('/project', {
      path: '/project/.openwaggle/worktrees/interrupted',
    }).pipe(
      Effect.provideService(
        SessionWorkspaceResourceRepository,
        workspaceRepository({ admission: 'reserved' }),
      ),
    )
    const fiber = Effect.runFork(effect)
    await vi.waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce())

    const interrupt = Effect.runPromise(Fiber.interrupt(fiber))
    await Promise.resolve()
    expect(mocks.finalizeRemoval).not.toHaveBeenCalled()
    finishRemoval({
      ok: true,
      path: '/project/.openwaggle/worktrees/interrupted',
      message: 'Removed worktree.',
    })
    await interrupt

    expect(mocks.finalizeRemoval).toHaveBeenCalledWith({
      resourceId: 'removal-resource',
      createdReservation: true,
      removed: true,
    })
  })

  it('reconciles tracked and synthetic removal reservations after Host loss', async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-worktree-recovery-'))
    const survivingPath = path.join(temporaryRoot, 'surviving')
    await fs.mkdir(survivingPath)
    const repository = workspaceRepository({ admission: 'reserved' })
    const effect = recoverPendingManagedWorktreeRemovals([
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
    ]).pipe(Effect.provideService(SessionWorkspaceResourceRepository, repository))

    await Effect.runPromise(effect)

    expect(mocks.finalizeRemoval.mock.calls.map((call) => call[0])).toEqual([
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
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-worktree-recovery-'))
    const loopPath = path.join(temporaryRoot, 'symlink-loop')
    await fs.symlink(loopPath, loopPath)
    const results = await Effect.runPromise(
      recoverPendingManagedWorktreeRemovals([
        { resourceId: 'tracked-loop', workingPath: loopPath, createdReservation: false },
        {
          resourceId: 'worktree-removal:synthetic',
          workingPath: loopPath,
          createdReservation: true,
        },
      ]).pipe(
        Effect.provideService(
          SessionWorkspaceResourceRepository,
          workspaceRepository({ admission: 'reserved' }),
        ),
      ),
    )

    expect(results.map((result) => result.outcome._tag)).toEqual(['Left', 'Right'])
    expect(mocks.finalizeRemoval).toHaveBeenCalledOnce()
    expect(mocks.finalizeRemoval).toHaveBeenCalledWith({
      resourceId: 'worktree-removal:synthetic',
      createdReservation: true,
      removed: false,
    })
  })

  it('rejects Session-bound creation after the binding disappears', async () => {
    const effect = createHostUiWorktree('/project', {
      path: '/renderer-selected',
      branch: 'renderer-selected',
      baseRef: 'main',
      sessionId: 'deleted-session',
    }).pipe(
      Effect.provideService(
        SessionWorkspaceResourceRepository,
        workspaceRepository({ boundWorkspace: null }),
      ),
    )

    await expect(Effect.runPromise(effect)).resolves.toEqual(
      expect.objectContaining({ ok: false, message: expect.stringContaining('no longer') }),
    )
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
