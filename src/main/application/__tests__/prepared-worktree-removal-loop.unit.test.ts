import { mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GitWorktreeMutationResult } from '@shared/types/git'
import type { WorkspacePreparation } from '@shared/types/workspace-preparation'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionWorkspaceResourceRepository } from '../../ports/session-workspace-resource-repository'
import { WorkspacePreparationService } from '../../ports/workspace-preparation-service'
import { removePreparedWorktree } from '../prepared-worktree-removal'
import { NoopActionRunServiceLayer } from './action-run-service-test-layer'

let temporaryRoot: string | null = null
afterEach(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = null
})

it.skipIf(process.platform === 'win32')(
  'refuses with the preparation reason instead of failing on a looping link',
  async () => {
    temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), 'openwaggle-removal-loop-')))
    const projectPath = join(temporaryRoot, 'project')
    const loop = join(temporaryRoot, 'loop')
    await symlink(loop, loop)
    const worktreePath = join(loop, 'worktree')
    const workspaceId = 'looped'
    const remove = vi.fn(() =>
      Effect.succeed<GitWorktreeMutationResult>({
        ok: true,
        message: 'removed',
        path: worktreePath,
      }),
    )
    const result = await Effect.runPromise(
      removePreparedWorktree(projectPath, { path: worktreePath }, Effect.suspend(remove), {
        retryFailed: true,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            NoopActionRunServiceLayer,
            Layer.succeed(
              SessionWorkspaceResourceRepository,
              fromPartial<SessionWorkspaceResourceRepository['Type']>({
                listManagedWorktreeRemovalCandidates: () =>
                  Effect.succeed([{ id: workspaceId, projectPath, workingPath: worktreePath }]),
                admitManagedWorktreeRemoval: () =>
                  Effect.succeed({
                    status: 'reserved',
                    resourceId: workspaceId,
                    createdReservation: false,
                  }),
                finalizeManagedWorktreeRemoval: () => Effect.void,
              }),
            ),
            Layer.succeed(
              WorkspacePreparationService,
              fromPartial<WorkspacePreparationService['Type']>({
                read: () =>
                  Effect.succeed(fromPartial<WorkspacePreparation>({ workspaceId, revision: 1 })),
                inspectWorkspaceGeneration: () =>
                  Effect.succeed({
                    status: 'unreadable' as const,
                    workspacePath: worktreePath,
                    reason: 'not-a-folder' as const,
                    recorded: { device: '1', inode: '2', birthtime: '3' },
                  }),
              }),
            ),
          ),
        ),
      ),
    )
    expect(result).toMatchObject({
      ok: false,
      code: 'cleanup-failed',
      message: expect.stringContaining(`${worktreePath} is not a plain folder`),
    })
    expect(remove).not.toHaveBeenCalled()
  },
)
