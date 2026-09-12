import { describe, expect, it, vi } from 'vitest'
import { runStackedGitAction } from '../stacked-action-service'
import { makeDeps } from './stacked-action-service.test-harness'

describe('runStackedGitAction', () => {
  it('stops at the failing phase and does not run later steps (centralized partial-failure)', async () => {
    const deps = makeDeps({
      push: vi.fn(async () => ({ ok: false, code: 'push-failed', message: 'boom' }) as const),
    })
    const result = await runStackedGitAction(deps, '/repo', {
      action: 'commit_push_pr',
      commitMessage: 'msg',
    })

    expect(result).toEqual({
      ok: false,
      phase: 'push',
      code: 'push-failed',
      message: 'boom',
      commit: { ok: true, commitHash: 'abc', summary: 'done' },
    })
    expect(deps.commit).toHaveBeenCalled()
    expect(deps.openChangeRequest).not.toHaveBeenCalled()
  })

  it('passes the caller-selected paths through to the commit phase (never whole-repo)', async () => {
    const deps = makeDeps()
    await runStackedGitAction(deps, '/repo', {
      action: 'commit',
      commitMessage: 'msg',
      paths: ['src/a.ts', 'src/b.ts'],
    })
    expect(deps.commit).toHaveBeenCalledWith('/repo', 'msg', ['src/a.ts', 'src/b.ts'], true)
  })

  it('passes staged-only intent through to the commit phase', async () => {
    const deps = makeDeps()
    await runStackedGitAction(deps, '/repo', {
      action: 'commit',
      commitMessage: 'msg',
      paths: ['src/a.ts'],
      includeUnstaged: false,
    })
    expect(deps.commit).toHaveBeenCalledWith('/repo', 'msg', ['src/a.ts'], false)
  })

  it('uses an exact user-entered branch name from live HEAD without sanitizing or suffixing it', async () => {
    const deps = makeDeps({
      listBranchNames: vi.fn(async () => ['feature/existing']),
    })
    await runStackedGitAction(deps, '/repo', {
      action: 'commit',
      commitMessage: 'msg',
      paths: ['src/a.ts'],
      createFeatureBranch: true,
      featureBranchName: 'release/Keep-Case',
      exactFeatureBranchName: true,
      baseRef: 'stale-main',
    })
    expect(deps.createBranch).toHaveBeenCalledWith('/repo', 'release/Keep-Case', 'HEAD')
  })

  it('creates a recovery branch at HEAD without moving a detached commit to the default ref', async () => {
    const deps = makeDeps({ resolveCurrentRef: vi.fn(async () => null) })
    await runStackedGitAction(deps, '/repo', {
      action: 'commit',
      commitMessage: 'msg',
      paths: ['src/a.ts'],
      createFeatureBranch: true,
      featureBranchName: 'feature/recover-detached',
      exactFeatureBranchName: true,
      baseRef: 'HEAD',
    })
    expect(deps.createBranch).toHaveBeenCalledWith('/repo', 'feature/recover-detached', 'HEAD')
  })

  it('cancels before push while retaining the completed commit', async () => {
    let cancelled = false
    const deps = makeDeps({
      commit: vi.fn(async () => {
        cancelled = true
        return { ok: true, commitHash: 'abc', summary: 'done' } as const
      }),
    })
    const result = await runStackedGitAction(
      deps,
      '/repo',
      { action: 'commit_push', commitMessage: 'msg', paths: ['src/a.ts'] },
      () => {},
      () => cancelled,
    )
    expect(result).toMatchObject({
      ok: false,
      phase: 'push',
      code: 'cancelled',
      commit: { commitHash: 'abc' },
    })
    expect(deps.push).not.toHaveBeenCalled()
  })

  it('refuses to invent a commit message for commit-bearing actions', async () => {
    const deps = makeDeps()
    const result = await runStackedGitAction(deps, '/repo', { action: 'commit_push' })
    expect(result).toMatchObject({
      ok: false,
      phase: 'commit',
      code: 'commit-message-required',
    })
    expect(deps.commit).not.toHaveBeenCalled()
  })

  it('maps a nothing-to-commit failure at the commit phase', async () => {
    const deps = makeDeps({
      commit: vi.fn(
        async () => ({ ok: false, code: 'nothing-to-commit', message: 'nothing' }) as const,
      ),
    })
    const result = await runStackedGitAction(deps, '/repo', {
      action: 'commit',
      commitMessage: 'msg',
    })
    expect(result).toMatchObject({ ok: false, phase: 'commit', code: 'nothing-to-commit' })
  })

  it('runs only pull for the pull action', async () => {
    const deps = makeDeps()
    const result = await runStackedGitAction(deps, '/repo', { action: 'pull' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.commit).toBeNull()
    expect(deps.pull).toHaveBeenCalled()
    expect(deps.commit).not.toHaveBeenCalled()
    expect(deps.push).not.toHaveBeenCalled()
  })

  it('skips commit when there are no working-tree changes for a push-only flow', async () => {
    const deps = makeDeps({
      hasWorkingTreeChanges: vi.fn(async () => ({ ok: true, hasChanges: false }) as const),
    })
    const result = await runStackedGitAction(deps, '/repo', { action: 'push' })
    expect(result.ok).toBe(true)
    expect(deps.commit).not.toHaveBeenCalled()
    expect(deps.push).toHaveBeenCalled()
  })

  it('does not require a commit message or commit dirty files for a push-only action', async () => {
    const deps = makeDeps()
    const result = await runStackedGitAction(deps, '/repo', { action: 'push' })
    expect(result.ok).toBe(true)
    expect(deps.commit).not.toHaveBeenCalled()
    expect(deps.push).toHaveBeenCalledOnce()
  })

  it('cancels before creating a requested branch', async () => {
    const deps = makeDeps()
    const result = await runStackedGitAction(
      deps,
      '/repo',
      {
        action: 'commit',
        commitMessage: 'msg',
        paths: ['src/a.ts'],
        createFeatureBranch: true,
        featureBranchName: 'feature/new',
      },
      () => {},
      () => true,
    )
    expect(result).toMatchObject({ ok: false, phase: 'branch', code: 'cancelled' })
    expect(deps.createBranch).not.toHaveBeenCalled()
    expect(deps.commit).not.toHaveBeenCalled()
  })

  it('fails instead of skipping the commit when the working tree cannot be read', async () => {
    /*
     * A failing `git status` used to be indistinguishable from a clean tree, so `commit_push`
     * quietly skipped the commit phase, pushed nothing new, and still reported success.
     */
    const deps = makeDeps({
      hasWorkingTreeChanges: vi.fn(
        async () => ({ ok: false, message: 'index.lock exists' }) as const,
      ),
    })

    const result = await runStackedGitAction(deps, '/repo', {
      action: 'commit_push',
      commitMessage: 'Ship it',
      paths: ['a.txt'],
    })

    expect(result).toMatchObject({ ok: false, phase: 'commit', message: 'index.lock exists' })
    expect(deps.commit).not.toHaveBeenCalled()
    expect(deps.push).not.toHaveBeenCalled()
  })

  it('reports exact branch and push progress totals', async () => {
    const deps = makeDeps()
    const events: Array<{ phase: string; index: number; total: number }> = []

    await runStackedGitAction(
      deps,
      '/repo',
      {
        action: 'push',
        createFeatureBranch: true,
        featureBranchName: 'feature/publish',
        exactFeatureBranchName: true,
      },
      ({ phase, index, total }) => events.push({ phase, index, total }),
    )

    expect(events).toEqual([
      { phase: 'branch', index: 0, total: 2 },
      { phase: 'push', index: 1, total: 2 },
    ])
  })

  it('reports one progress event per commit, push, and change-request mutation', async () => {
    const deps = makeDeps()
    const events: Array<{ phase: string; index: number; total: number }> = []

    await runStackedGitAction(
      deps,
      '/repo',
      {
        action: 'commit_push_pr',
        commitMessage: 'Ship it',
        createFeatureBranch: true,
        featureBranchName: 'feature/publish',
        exactFeatureBranchName: true,
      },
      ({ phase, index, total }) => events.push({ phase, index, total }),
    )

    expect(events).toEqual([
      { phase: 'branch', index: 0, total: 4 },
      { phase: 'commit', index: 1, total: 4 },
      { phase: 'push', index: 2, total: 4 },
      { phase: 'pr', index: 3, total: 4 },
    ])
  })

  it('reports branch, push, and change-request progress for create_pr', async () => {
    const deps = makeDeps()
    const events: Array<{ phase: string; index: number; total: number }> = []

    await runStackedGitAction(
      deps,
      '/repo',
      {
        action: 'create_pr',
        createFeatureBranch: true,
        featureBranchName: 'feature/publish',
        exactFeatureBranchName: true,
      },
      ({ phase, index, total }) => events.push({ phase, index, total }),
    )

    expect(events).toEqual([
      { phase: 'branch', index: 0, total: 3 },
      { phase: 'push', index: 1, total: 3 },
      { phase: 'pr', index: 2, total: 3 },
    ])
  })
})
