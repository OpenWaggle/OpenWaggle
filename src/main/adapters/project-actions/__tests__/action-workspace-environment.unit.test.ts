import type { WorkspacePreparation } from '@shared/types/workspace-preparation'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { expect, it, vi } from 'vitest'
import type { WorkspaceGenerationCheck } from '../../../domain/workspace-generation'
import type { ActionRunWorkspace } from '../../../ports/action-run-service'
import type { WorkspacePreparationServiceShape } from '../../../ports/workspace-preparation-service'
import { readActionWorkspaceEnvironment } from '../action-workspace-environment'

const worktree: ActionRunWorkspace = {
  workspaceId: 'worktree-1',
  projectPath: '/project',
  workspacePath: '/project/.openwaggle/worktrees/one',
}

const recorded = { device: '16777233', inode: '408642463', birthtime: '1792486351612449418' }
const replaced: WorkspaceGenerationCheck = {
  status: 'replaced',
  workspacePath: worktree.workspacePath,
  recorded,
  observed: { device: '16777230', inode: '500', birthtime: '1792563460000000000' },
}

function preparation(state: WorkspacePreparation | null, check: WorkspaceGenerationCheck) {
  const read = vi.fn(() => Effect.succeed(state))
  const inspectWorkspaceGeneration = vi.fn(() => Effect.succeed(check))
  const environment = vi.fn(() => Effect.succeed({ TOOLCHAIN_PATH: '/old-checkout/bin' }))
  return {
    service: fromPartial<WorkspacePreparationServiceShape>({
      read,
      inspectWorkspaceGeneration,
      environment,
    }),
    read,
    inspectWorkspaceGeneration,
    environment,
  }
}

it('rejects an old checkout generation before supplying its prepared environment', async () => {
  const fixture = preparation(fromPartial<WorkspacePreparation>({ revision: 1 }), replaced)
  await expect(readActionWorkspaceEnvironment(fixture.service, worktree)).rejects.toThrow(
    `This worktree no longer matches its saved preparation: ${worktree.workspacePath} is a different folder from the one that was prepared (recorded inode 408642463, created 1792486351612449418, device 16777233; found inode 500, created 1792563460000000000, device 16777230). Restore the original folder at that path, or hand this Session to another Workspace.`,
  )
  expect(fixture.read).toHaveBeenCalledWith(worktree)
  expect(fixture.inspectWorkspaceGeneration).toHaveBeenCalledWith(worktree)
  expect(fixture.environment).not.toHaveBeenCalled()
})

it('uses prepared exports for the current worktree generation', async () => {
  const fixture = preparation(fromPartial<WorkspacePreparation>({ revision: 1 }), {
    status: 'current',
  })
  await expect(readActionWorkspaceEnvironment(fixture.service, worktree)).resolves.toEqual({
    TOOLCHAIN_PATH: '/old-checkout/bin',
    OPENWAGGLE_PROJECT_ROOT: worktree.projectPath,
    OPENWAGGLE_WORKTREE_PATH: worktree.workspacePath,
  })
})

it('allows a worktree without a preparation snapshot', async () => {
  const fixture = preparation(null, replaced)
  await expect(readActionWorkspaceEnvironment(fixture.service, worktree)).resolves.toMatchObject({
    OPENWAGGLE_PROJECT_ROOT: worktree.projectPath,
    OPENWAGGLE_WORKTREE_PATH: worktree.workspacePath,
  })
  expect(fixture.inspectWorkspaceGeneration).not.toHaveBeenCalled()
})

it('keeps project-root actions available without a worktree generation', async () => {
  const fixture = preparation(fromPartial<WorkspacePreparation>({ revision: 1 }), replaced)
  await expect(
    readActionWorkspaceEnvironment(fixture.service, {
      ...worktree,
      workspacePath: worktree.projectPath,
    }),
  ).resolves.toHaveProperty('TOOLCHAIN_PATH', '/old-checkout/bin')
  expect(fixture.inspectWorkspaceGeneration).not.toHaveBeenCalled()
})

it.each([
  [
    { status: 'unreadable', workspacePath: worktree.workspacePath, recorded },
    `${worktree.workspacePath} is missing or is not a plain folder (recorded inode 408642463, created 1792486351612449418, device 16777233). Restore the worktree folder`,
  ],
  [
    { status: 'unrecorded', workspacePath: worktree.workspacePath },
    `no folder identity was recorded for ${worktree.workspacePath}. Hand this Session to another Workspace`,
  ],
] satisfies [WorkspaceGenerationCheck, string][])(
  'names the failing check (%o) in the error',
  async (check, detail) => {
    const fixture = preparation(fromPartial<WorkspacePreparation>({ revision: 1 }), check)
    await expect(readActionWorkspaceEnvironment(fixture.service, worktree)).rejects.toThrow(detail)
    expect(fixture.environment).not.toHaveBeenCalled()
  },
)
