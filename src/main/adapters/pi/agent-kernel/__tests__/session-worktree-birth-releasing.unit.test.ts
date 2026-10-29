import type { GitWorktreeMutationResult } from '@shared/types/git'
import { describe, expect, it, vi } from 'vitest'
import type { BoundWorkspaceResource } from '../../../../store/session-details'
import { session } from './session-worktree-birth-test-helpers'

const mocks = vi.hoisted(() => ({
  adoptSessionWorktreeForSetup: vi.fn(async () => null),
  resetSessionWorktreeSetup: vi.fn(),
  createGitWorktree: vi.fn(
    async (): Promise<GitWorktreeMutationResult> => ({ ok: true, message: 'ok', path: '/wt' }),
  ),
  getBoundWorkspaceResource: vi.fn<() => Promise<BoundWorkspaceResource | null>>(),
}))

// The recorded folder is still there: only the Workspace state can stop the Run.
vi.mock('node:fs', () => ({ existsSync: () => true }))
vi.mock('../../../git/run-git', () => ({
  runGit: async () => ({ code: 0, stdout: 'main\n', stderr: '' }),
}))
vi.mock('../session-branch-freshness', () => ({ resolveFreshWorktreeBaseRef: async () => 'main' }))
vi.mock('../../../git/worktree', () => ({ createGitWorktree: mocks.createGitWorktree }))
vi.mock('../../../../store/session-details', () => ({
  getBoundWorkspaceResource: mocks.getBoundWorkspaceResource,
  validateSessionWorktreeBirthAuthority: vi.fn(async () => {}),
  adoptSessionWorktreeForSetup: mocks.adoptSessionWorktreeForSetup,
  resetSessionWorktreeSetup: mocks.resetSessionWorktreeSetup,
  setSessionWorktree: vi.fn(async () => {}),
}))
vi.mock('../session-worktree-setup-dispatch', () => ({
  dispatchPendingSessionWorktreeSetup: vi.fn(),
}))
vi.mock('../../../git/workspace-handoff-snapshot', () => ({
  applyWorkspaceHandoffSeed: vi.fn(async () => {}),
  releaseWorkspaceHandoffSeed: vi.fn(async () => {}),
}))

const { ensureSessionWorktreeProjectPath } = await import('../session-worktree-birth')

describe('a Run in a worktree that Settings is removing (ADR 0060)', () => {
  it('is refused while the Workspace is releasing, even though its folder still exists', async () => {
    mocks.getBoundWorkspaceResource.mockResolvedValue({
      id: 'workspace-feature',
      projectPath: '/repo',
      kind: 'managed-worktree',
      workingPath: '/wt/feature',
      lifecycleState: 'releasing',
      worktreeBranch: 'ow/feature',
      worktreeBaseRef: 'main',
      worktreeStartFromOrigin: false,
      handoffSeedRef: null,
      handoffSeedBaseRef: null,
      handoffSeedState: 'none',
    })

    await expect(
      ensureSessionWorktreeProjectPath(
        session({ environmentMode: 'worktree', worktreePath: '/wt/feature' }),
      ),
    ).rejects.toThrow(/Workspace is releasing/)
    expect(mocks.adoptSessionWorktreeForSetup).not.toHaveBeenCalled()
    expect(mocks.resetSessionWorktreeSetup).not.toHaveBeenCalled()
    expect(mocks.createGitWorktree).not.toHaveBeenCalled()
  })
})
