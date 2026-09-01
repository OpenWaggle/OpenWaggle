import type { GitActionProgressEvent } from '@shared/types/git'
import { describe, expect, it, vi } from 'vitest'
import { runStackedGitAction, type StackedActionDeps } from '../stacked-action-service'

function makeDeps(overrides: Partial<StackedActionDeps> = {}): StackedActionDeps {
  return {
    hasWorkingTreeChanges: vi.fn(async () => ({ ok: true, hasChanges: true }) as const),
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
    resolveCurrentRef: vi.fn(async () => 'feature/current'),
    resolveDefaultBaseRef: vi.fn(async () => 'main'),
    buildChangeRequestFallbackUrl: vi.fn(async () => 'https://example.test/new-change-request'),
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
      expect(result.commit).toEqual({ ok: true, commitHash: 'abc', summary: 'done' })
      expect(result.changeRequest?.state).toBe('open')
    }
  })

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

  it('returns and resumes the prepared branch after a partial failure', async () => {
    const push = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: 'push-failed', message: 'offline' })
      .mockResolvedValueOnce({ ok: true, code: 'ok', message: 'pushed' })
    let currentRef = 'main'
    const deps = makeDeps({
      push,
      createBranch: vi.fn(async (_projectPath, name) => {
        currentRef = name
        return { ok: true, message: 'created' }
      }),
      resolveCurrentRef: vi.fn(async () => currentRef),
      hasWorkingTreeChanges: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, hasChanges: true })
        .mockResolvedValueOnce({ ok: true, hasChanges: false }),
    })
    const options = {
      action: 'commit_push_pr' as const,
      commitMessage: 'Ship it',
      createFeatureBranch: true,
      featureBranchName: 'codex/retry-safe',
      paths: ['src/a.ts'],
    }

    const first = await runStackedGitAction(deps, '/repo', options)
    expect(first).toMatchObject({
      ok: false,
      branch: { name: 'codex/retry-safe' },
    })
    const second = await runStackedGitAction(deps, '/repo', options)

    expect(second.ok).toBe(true)
    expect(deps.createBranch).toHaveBeenCalledOnce()
    expect(deps.commit).toHaveBeenCalledOnce()
    expect(deps.openChangeRequest).toHaveBeenCalledWith(
      '/repo',
      expect.objectContaining({ headRef: 'codex/retry-safe' }),
    )
  })

  it('returns a browser fallback when native change-request creation fails', async () => {
    const deps = makeDeps({
      openChangeRequest: vi.fn(
        async () =>
          ({
            ok: false,
            code: 'cli-missing',
            message: 'CLI missing',
          }) as const,
      ),
    })
    const result = await runStackedGitAction(deps, '/repo', { action: 'create_pr' })
    expect(result).toMatchObject({
      ok: false,
      phase: 'pr',
      fallbackUrl: 'https://example.test/new-change-request',
    })
  })

  it('resolves head/base refs for create_pr when no feature branch was created (no empty --head)', async () => {
    const deps = makeDeps()
    const result = await runStackedGitAction(deps, '/repo', { action: 'create_pr' })
    expect(result.ok).toBe(true)
    expect(deps.resolveCurrentRef).toHaveBeenCalledWith('/repo')
    expect(deps.openChangeRequest).toHaveBeenCalledWith(
      '/repo',
      expect.objectContaining({ headRef: 'feature/current', baseRef: 'main' }),
    )
  })

  it('omits an unresolved base ref so the provider can use its repository default', async () => {
    const deps = makeDeps({ resolveDefaultBaseRef: vi.fn(async () => null) })

    const result = await runStackedGitAction(deps, '/repo', { action: 'create_pr' })

    expect(result.ok).toBe(true)
    expect(deps.openChangeRequest).toHaveBeenCalledWith(
      '/repo',
      expect.not.objectContaining({ baseRef: expect.anything() }),
    )
  })

  it('pushes a clean unpublished branch before opening its change request', async () => {
    const order: string[] = []
    const deps = makeDeps({
      hasWorkingTreeChanges: vi.fn(async () => ({ ok: true, hasChanges: false }) as const),
      push: vi.fn(async () => {
        order.push('push')
        return { ok: true, code: 'ok', message: 'pushed' } as const
      }),
      openChangeRequest: vi.fn(async () => {
        order.push('pr')
        return {
          ok: true,
          changeRequest: {
            title: 'T',
            url: 'https://x/pull/1',
            baseRef: 'main',
            headRef: 'feature/current',
            state: 'open' as const,
          },
        } as const
      }),
    })

    const result = await runStackedGitAction(deps, '/repo', { action: 'create_pr' })

    expect(result.ok).toBe(true)
    expect(order).toEqual(['push', 'pr'])
    expect(deps.commit).not.toHaveBeenCalled()
  })

  it('fails the pr phase when no head ref is resolvable (instead of empty --head)', async () => {
    const deps = makeDeps({ resolveCurrentRef: vi.fn(async () => null) })
    const result = await runStackedGitAction(deps, '/repo', { action: 'create_pr' })
    expect(result).toMatchObject({ ok: false, phase: 'pr', code: 'change-request-failed' })
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
