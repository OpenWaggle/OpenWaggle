import type { WorkspacePreparation } from '@shared/types/workspace-preparation'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceGenerationCheck } from '../../domain/workspace-generation'
import { ActionRunService } from '../../ports/action-run-service'
import { WorkspacePreparationService } from '../../ports/workspace-preparation-service'
import { prepareWorkspaceRemoval } from '../workspace-cleanup'

const warn = vi.hoisted(() => vi.fn())
vi.mock('../../logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn, info: vi.fn(), debug: vi.fn() }),
}))

const workspace = {
  workspaceId: 'workspace',
  projectPath: '/repo',
  workspacePath: '/repo/worktree',
}
const recorded = { device: '16777233', inode: '408642463', birthtime: '1792486351612449418' }
const replaced: WorkspaceGenerationCheck = {
  status: 'replaced',
  workspacePath: '/repo/worktree',
  recorded,
  observed: { device: '16777230', inode: '500', birthtime: '1792563460000000000' },
}
function fixture(
  status: WorkspacePreparation['cleanup']['status'],
  generation: WorkspaceGenerationCheck = { status: 'current' },
) {
  const state = fromPartial<WorkspacePreparation>({
    workspaceId: workspace.workspaceId,
    revision: 4,
    cleanup: { status, error: 'cleanup failed', output: 'retained output' },
  })
  const order: string[] = []
  const stop = vi.fn(() =>
    Effect.sync(() => {
      order.push('stop')
    }),
  )
  const run = vi.fn(() =>
    Effect.sync(() => {
      order.push('cleanup')
      return state
    }),
  )
  const skip = vi.fn(() => Effect.succeed(state))
  const perform = (options: { retryFailed: boolean; skipCleanup?: boolean }) =>
    Effect.runPromise(
      prepareWorkspaceRemoval(workspace, options).pipe(
        Effect.provideService(ActionRunService, fromPartial({ stopWorkspaceRuns: stop })),
        Effect.provideService(
          WorkspacePreparationService,
          fromPartial({
            read: () => Effect.succeed(state),
            inspectWorkspaceGeneration: () => Effect.succeed(generation),
            run,
            skip,
          }),
        ),
      ),
    )
  return { perform, run, skip, order }
}
describe('workspace cleanup removal boundary', () => {
  it('stops owned executions before cleanup and retains the workspace on failure', async () => {
    const test = fixture('failed')
    expect(await test.perform({ retryFailed: true })).toMatchObject({
      ok: false,
      code: 'cleanup-failed',
      preparation: { workspaceId: 'workspace' },
    })
    expect(test.order).toEqual(['stop', 'cleanup'])
    expect(test.skip).not.toHaveBeenCalled()
  })
  it('does not automatically retry failed cleanup during Host recovery', async () => {
    const test = fixture('failed')
    expect(await test.perform({ retryFailed: false })).toMatchObject({ code: 'cleanup-failed' })
    expect(test.run).not.toHaveBeenCalled()
  })
  it('records an explicit Delete anyway and permits removal', async () => {
    const test = fixture('review-required')
    expect(await test.perform({ retryFailed: true, skipCleanup: true })).toBeNull()
    expect(test.skip).toHaveBeenCalledWith(workspace, 'cleanup', 4)
    expect(test.run).not.toHaveBeenCalled()
  })
  it('does not run idle cleanup when Force remove explicitly skips it', async () => {
    const test = fixture('idle')
    expect(await test.perform({ retryFailed: true, skipCleanup: true })).toBeNull()
    expect(test.skip).toHaveBeenCalledWith(workspace, 'cleanup', 4)
    expect(test.run).not.toHaveBeenCalled()
    expect(test.order).toEqual(['stop'])
  })
  it('permits removal after successful cleanup', async () => {
    const test = fixture('succeeded')
    expect(await test.perform({ retryFailed: true })).toBeNull()
  })
  it('never runs retained cleanup in a replacement checkout at the same path', async () => {
    const test = fixture('failed', replaced)
    expect(await test.perform({ retryFailed: true })).toMatchObject({
      ok: false,
      code: 'cleanup-failed',
      message: expect.stringContaining(
        'no longer matches the checkout that captured its preparation: /repo/worktree is a different folder from the one that was prepared (prepared: inode 408642463, created 2026-10-20T08:52:31.612Z; found: inode 500, created 2026-10-21T06:17:40.000Z). Its pinned cleanup cannot run here.',
      ),
    })
    expect(warn).toHaveBeenCalledWith(
      'Worktree cleanup refused: it does not match its saved preparation',
      { workspaceId: workspace.workspaceId, ...replaced },
    )
    expect(test.run).not.toHaveBeenCalled()
    expect(test.skip).not.toHaveBeenCalled()
    expect(await test.perform({ retryFailed: true, skipCleanup: true })).toBeNull()
    expect(test.skip).toHaveBeenCalledWith(workspace, 'cleanup', 4)
  })
  it('still offers explicit Delete anyway when old cleanup had succeeded', async () => {
    const test = fixture('succeeded', replaced)
    expect(await test.perform({ retryFailed: true })).toMatchObject({
      ok: false,
      code: 'cleanup-failed',
      message: expect.stringContaining('Delete anyway'),
    })
    expect(test.run).not.toHaveBeenCalled()
    expect(await test.perform({ retryFailed: true, skipCleanup: true })).toBeNull()
    expect(test.skip).toHaveBeenCalledWith(workspace, 'cleanup', 4)
  })
  it.each([
    [
      { status: 'unrecorded', workspacePath: '/repo/worktree' },
      'This worktree cannot be checked against the checkout that captured its preparation: the preparation has no record of the folder /repo/worktree. Its pinned cleanup cannot run here.',
    ],
    [
      { status: 'awaiting-birth', workspacePath: '/repo/worktree' },
      'This worktree cannot be checked against the checkout that captured its preparation: the preparation was reset for a new worktree and has not recorded /repo/worktree yet.',
    ],
    [
      { status: 'unreadable', workspacePath: '/repo/worktree', reason: 'not-a-folder', recorded },
      'This worktree no longer matches the checkout that captured its preparation: /repo/worktree is not a plain folder. Its pinned cleanup cannot run here.',
    ],
  ] satisfies [WorkspaceGenerationCheck, string][])(
    'refuses cleanup and names the %o check',
    async (generation, message) => {
      const test = fixture('idle', generation)
      expect(await test.perform({ retryFailed: true })).toMatchObject({
        ok: false,
        code: 'cleanup-failed',
        message: expect.stringContaining(message),
      })
      expect(test.run).not.toHaveBeenCalled()
    },
  )
})
