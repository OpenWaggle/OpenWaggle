import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoundWorkspaceResource } from '../../../../store/session-details'
import { session } from './session-worktree-birth-test-helpers'

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn((candidate: string) => !candidate.includes('/.openwaggle/worktrees/')),
  runGit: vi.fn(async (_cwd: string, _args: readonly string[]) => ({
    code: 0,
    stdout: 'main\n',
    stderr: '',
  })),
  createGitWorktree: vi.fn(async () => ({ ok: true, message: 'ok', path: '/wt' })),
  resolveFreshWorktreeBaseRef: vi.fn(
    async (
      workspace: Pick<BoundWorkspaceResource, 'worktreeBaseRef'>,
      _projectPath: string,
      options?: { readonly onFetch?: (base: string) => void },
    ): Promise<string | null> => {
      const base = workspace.worktreeBaseRef ?? 'main'
      options?.onFetch?.(base)
      return base
    },
  ),
}))

vi.mock('node:fs', () => ({ existsSync: mocks.existsSync }))
vi.mock('../../../git/run-git', () => ({ runGit: mocks.runGit }))
vi.mock('../session-branch-freshness', () => ({
  resolveFreshWorktreeBaseRef: mocks.resolveFreshWorktreeBaseRef,
}))
vi.mock('../../../git/worktree', () => ({ createGitWorktree: mocks.createGitWorktree }))
vi.mock('../../../../store/session-details', () => ({
  getBoundWorkspaceResource: vi.fn(async () => null),
  validateSessionWorktreeBirthAuthority: vi.fn(async () => {}),
  adoptSessionWorktreeForSetup: vi.fn(async () => null),
  resetSessionWorktreeSetup: vi.fn(async (_id: unknown, worktreePath: string) => ({
    worktreePath,
    generation: 'generation-1',
  })),
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

describe('worktree birth progress', () => {
  beforeEach(() => {
    mocks.createGitWorktree.mockClear()
  })

  it('reports each first-send Git step with its label, branch, and base ref', async () => {
    const onProgress = vi.fn()

    const result = await ensureSessionWorktreeProjectPath(
      session({ environmentMode: 'worktree', worktreeBaseRef: 'develop' }),
      { onProgress },
    )

    const branchDetails = {
      branch: 'ow/session-sess-abcdef12',
      baseRef: 'develop',
      worktreePath: result,
    }
    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
      {
        stage: 'preparing-workspace',
        label: 'Preparing the session worktree',
        details: ['Preparing the session worktree'],
      },
      {
        stage: 'fetching-base',
        label: 'Pulling latest develop from origin',
        details: ['Fetching origin/develop'],
      },
      {
        stage: 'checking-out-files',
        label: 'Creating worktree ow/session-sess-abcdef12 from develop',
        details: ['Creating ow/session-sess-abcdef12 from develop'],
        ...branchDetails,
      },
      {
        stage: 'worktree-created',
        details: ['Created ow/session-sess-abcdef12 from develop'],
        ...branchDetails,
      },
    ])
  })

  it('reports nothing for a later turn that reuses its recorded worktree', async () => {
    const onProgress = vi.fn()
    await ensureSessionWorktreeProjectPath(
      session({ environmentMode: 'worktree', worktreePath: '/wt/existing' }),
      { onProgress },
    )
    // A launch card on every turn flashed the transcript and the sidebar status.
    expect(onProgress).not.toHaveBeenCalled()
    expect(mocks.createGitWorktree).not.toHaveBeenCalled()
  })
})
