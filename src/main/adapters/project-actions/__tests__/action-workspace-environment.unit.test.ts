import { classifyErrorMessage } from '@shared/domain/error-classifier'
import type { WorkspacePreparation } from '@shared/types/workspace-preparation'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { beforeEach, expect, it, vi } from 'vitest'
import type { WorkspaceGenerationCheck } from '../../../domain/workspace-generation'
import type { ActionRunWorkspace } from '../../../ports/action-run-service'
import type { WorkspacePreparationServiceShape } from '../../../ports/workspace-preparation-service'
import { readActionWorkspaceEnvironment } from '../action-workspace-environment'

const warn = vi.hoisted(() => vi.fn())
vi.mock('../../../logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn, info: vi.fn(), debug: vi.fn() }),
}))
beforeEach(() => warn.mockClear())

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

function preparation(state: WorkspacePreparation | null, check: WorkspaceGenerationCheck | Error) {
  const read = vi.fn(() => Effect.succeed(state))
  const inspectWorkspaceGeneration = vi.fn(() =>
    check instanceof Error ? Effect.fail(check) : Effect.succeed(check),
  )
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
    `This worktree no longer matches its saved preparation: ${worktree.workspacePath} is a different folder from the one that was prepared. If the original folder still exists somewhere else, put it back at that path in place of this one. Otherwise, commit or copy out any changes you want to keep, then delete that folder; when you reopen this Session, choose Recreate worktree or Use current checkout. Prepared: inode 408642463, created 2026-10-20 08:52:31 UTC; found: inode 500, created 2026-10-21 06:17:40 UTC.`,
  )
  // The log keeps every raw field, device included, so the failing branch is diagnosable.
  expect(warn).toHaveBeenCalledWith('Worktree failed its saved-preparation check', {
    workspaceId: worktree.workspaceId,
    ...replaced,
  })
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
    { status: 'unreadable', workspacePath: worktree.workspacePath, reason: 'missing', recorded },
    `This worktree no longer matches its saved preparation: ${worktree.workspacePath} is missing. If you moved or renamed it, move it back. Otherwise, when you reopen this Session, choose Recreate worktree or Use current checkout.`,
  ],
  [
    {
      status: 'unreadable',
      workspacePath: worktree.workspacePath,
      reason: 'not-a-folder',
      recorded,
    },
    `This worktree no longer matches its saved preparation: ${worktree.workspacePath} is not a plain folder. Remove what is at that path, or the file or looping link on the way to it; when you reopen this Session, choose Recreate worktree or Use current checkout.`,
  ],
  [
    { status: 'awaiting-birth', workspacePath: worktree.workspacePath },
    `This worktree cannot be checked against its saved preparation: the preparation was reset for a new worktree and has not recorded ${worktree.workspacePath} yet. To continue, commit or copy out any changes you want to keep, then delete that folder;`,
  ],
  [
    { status: 'unrecorded', workspacePath: worktree.workspacePath },
    `This worktree cannot be checked against its saved preparation: the preparation has no record of the folder ${worktree.workspacePath}. To continue, commit or copy out`,
  ],
] satisfies [WorkspaceGenerationCheck, string][])(
  'names the failing check (%o) in the error',
  async (check, detail) => {
    const fixture = preparation(fromPartial<WorkspacePreparation>({ revision: 1 }), check)
    await expect(readActionWorkspaceEnvironment(fixture.service, worktree)).rejects.toThrow(detail)
    expect(warn).toHaveBeenCalledWith('Worktree failed its saved-preparation check', {
      workspaceId: worktree.workspaceId,
      ...check,
    })
    expect(fixture.environment).not.toHaveBeenCalled()
  },
)

it('keeps the recovery advice inside the 600 characters a run error shows', async () => {
  const longRoot = `/Volumes/Work Drive/${'x'.repeat(64)}`
  const long: ActionRunWorkspace = {
    workspaceId: 'worktree-1',
    projectPath: longRoot,
    workspacePath: `${longRoot}/.openwaggle/worktrees/${'y'.repeat(64)}/11111111-2222-3333-4444-555555555555`,
  }
  // The longest identity text: no birth time, so both devices are shown.
  const longest: WorkspaceGenerationCheck = {
    status: 'replaced',
    workspacePath: long.workspacePath,
    recorded: { device: '1', inode: '408642463', birthtime: '0' },
    observed: { device: '2', inode: '408642463', birthtime: '0' },
  }
  const fixture = preparation(fromPartial<WorkspacePreparation>({ revision: 1 }), longest)
  const failure = await readActionWorkspaceEnvironment(fixture.service, long).catch(
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  )
  // The chat card shows it as its own headline, whatever the path contains.
  expect(classifyErrorMessage(`Error: ${String(failure)}`)).toMatchObject({
    code: 'worktree-preparation-mismatch',
    retryable: false,
  })
  const RUN_ERROR_LIMIT = 600
  const advice = 'choose Recreate worktree or Use current checkout.'
  expect(`Error: ${String(failure)}`.indexOf(advice) + advice.length).toBeLessThanOrEqual(
    RUN_ERROR_LIMIT,
  )
})
