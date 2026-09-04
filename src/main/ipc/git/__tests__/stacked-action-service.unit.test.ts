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
    expect(deps.commit).toHaveBeenCalledWith('/repo', 'msg', ['src/a.ts', 'src/b.ts'])
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
})
