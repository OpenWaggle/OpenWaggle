import type { GitActionProgressEvent } from '@shared/types/git'
import { describe, expect, it, vi } from 'vitest'
import { runStackedGitAction, type StackedActionDeps } from '../stacked-action-service'

function makeDeps(overrides: Partial<StackedActionDeps> = {}): StackedActionDeps {
  return {
    hasWorkingTreeChanges: vi.fn(async () => true),
    listBranchNames: vi.fn(async () => ['main']),
    createBranch: vi.fn(async () => ({ ok: true, message: 'created' })),
    commit: vi.fn(async () => ({ ok: true, commitHash: 'abc', summary: 'done' }) as const),
    push: vi.fn(async () => ({ ok: true, code: 'ok', message: 'pushed' }) as const),
    pull: vi.fn(async () => ({ ok: true, code: 'ok', message: 'pulled' }) as const),
    openChangeRequest: vi.fn(
      async () =>
        ({
          ok: true,
          changeRequest: {
            title: 'T',
            url: 'https://x/pull/1',
            baseRef: 'main',
            headRef: 'feature/update',
            state: 'open' as const,
          },
        }) as const,
    ),
    ...overrides,
  }
}

describe('runStackedGitAction', () => {
  it('runs commit -> push -> pr in order for commit_push_pr', async () => {
    const deps = makeDeps()
    const events: GitActionProgressEvent[] = []
    const result = await runStackedGitAction(
      deps,
      '/repo',
      {
        action: 'commit_push_pr',
        commitMessage: 'msg',
        createFeatureBranch: true,
        baseRef: 'main',
      },
      (event) => events.push(event),
    )

    expect(result.ok).toBe(true)
    expect(deps.createBranch).toHaveBeenCalled()
    expect(deps.commit).toHaveBeenCalled()
    expect(deps.push).toHaveBeenCalled()
    expect(deps.openChangeRequest).toHaveBeenCalled()
    expect(events.map((e) => e.phase)).toEqual(['branch', 'commit', 'push', 'pr'])
    if (result.ok) {
      expect(result.branch).toEqual({ status: 'created', name: 'feature/update' })
      expect(result.changeRequest?.state).toBe('open')
    }
  })

  it('stops at the failing phase and does not run later steps (centralized partial-failure)', async () => {
    const deps = makeDeps({
      push: vi.fn(async () => ({ ok: false, code: 'push-failed', message: 'boom' }) as const),
    })
    const result = await runStackedGitAction(deps, '/repo', { action: 'commit_push_pr' })

    expect(result).toEqual({ ok: false, phase: 'push', code: 'push-failed', message: 'boom' })
    expect(deps.commit).toHaveBeenCalled()
    expect(deps.openChangeRequest).not.toHaveBeenCalled()
  })

  it('maps a nothing-to-commit failure at the commit phase', async () => {
    const deps = makeDeps({
      commit: vi.fn(
        async () => ({ ok: false, code: 'nothing-to-commit', message: 'nothing' }) as const,
      ),
    })
    const result = await runStackedGitAction(deps, '/repo', { action: 'commit' })
    expect(result).toMatchObject({ ok: false, phase: 'commit', code: 'nothing-to-commit' })
  })

  it('runs only pull for the pull action', async () => {
    const deps = makeDeps()
    const result = await runStackedGitAction(deps, '/repo', { action: 'pull' })
    expect(result.ok).toBe(true)
    expect(deps.pull).toHaveBeenCalled()
    expect(deps.commit).not.toHaveBeenCalled()
    expect(deps.push).not.toHaveBeenCalled()
  })

  it('skips commit when there are no working-tree changes for a push-only flow', async () => {
    const deps = makeDeps({ hasWorkingTreeChanges: vi.fn(async () => false) })
    const result = await runStackedGitAction(deps, '/repo', { action: 'push' })
    expect(result.ok).toBe(true)
    expect(deps.commit).not.toHaveBeenCalled()
    expect(deps.push).toHaveBeenCalled()
  })
})
