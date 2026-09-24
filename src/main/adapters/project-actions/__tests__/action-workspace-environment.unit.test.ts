import type { WorkspacePreparation } from '@shared/types/workspace-preparation'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { expect, it, vi } from 'vitest'
import type { ActionRunWorkspace } from '../../../ports/action-run-service'
import type { WorkspacePreparationServiceShape } from '../../../ports/workspace-preparation-service'
import { readActionWorkspaceEnvironment } from '../action-workspace-environment'

const worktree: ActionRunWorkspace = {
  workspaceId: 'worktree-1',
  projectPath: '/project',
  workspacePath: '/project/.openwaggle/worktrees/one',
}

function preparation(state: WorkspacePreparation | null, current: boolean) {
  const read = vi.fn(() => Effect.succeed(state))
  const isCurrentWorkspaceGeneration = vi.fn(() => Effect.succeed(current))
  const environment = vi.fn(() => Effect.succeed({ TOOLCHAIN_PATH: '/old-checkout/bin' }))
  return {
    service: fromPartial<WorkspacePreparationServiceShape>({
      read,
      isCurrentWorkspaceGeneration,
      environment,
    }),
    read,
    isCurrentWorkspaceGeneration,
    environment,
  }
}

it('rejects an old checkout generation before supplying its prepared environment', async () => {
  const fixture = preparation(fromPartial<WorkspacePreparation>({ revision: 1 }), false)
  await expect(readActionWorkspaceEnvironment(fixture.service, worktree)).rejects.toThrow(
    'no longer matches its saved preparation',
  )
  expect(fixture.read).toHaveBeenCalledWith(worktree)
  expect(fixture.isCurrentWorkspaceGeneration).toHaveBeenCalledWith(worktree)
  expect(fixture.environment).not.toHaveBeenCalled()
})

it('uses prepared exports for the current worktree generation', async () => {
  const fixture = preparation(fromPartial<WorkspacePreparation>({ revision: 1 }), true)
  await expect(readActionWorkspaceEnvironment(fixture.service, worktree)).resolves.toEqual({
    TOOLCHAIN_PATH: '/old-checkout/bin',
    OPENWAGGLE_PROJECT_ROOT: worktree.projectPath,
    OPENWAGGLE_WORKTREE_PATH: worktree.workspacePath,
  })
})

it('allows a worktree without a preparation snapshot', async () => {
  const fixture = preparation(null, false)
  await expect(readActionWorkspaceEnvironment(fixture.service, worktree)).resolves.toMatchObject({
    OPENWAGGLE_PROJECT_ROOT: worktree.projectPath,
    OPENWAGGLE_WORKTREE_PATH: worktree.workspacePath,
  })
  expect(fixture.isCurrentWorkspaceGeneration).not.toHaveBeenCalled()
})

it('keeps project-root actions available without a worktree generation', async () => {
  const fixture = preparation(fromPartial<WorkspacePreparation>({ revision: 1 }), false)
  await expect(
    readActionWorkspaceEnvironment(fixture.service, {
      ...worktree,
      workspacePath: worktree.projectPath,
    }),
  ).resolves.toHaveProperty('TOOLCHAIN_PATH', '/old-checkout/bin')
  expect(fixture.isCurrentWorkspaceGeneration).not.toHaveBeenCalled()
})
