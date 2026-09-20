import type { GitActionProgressEvent } from '@shared/types/git'
import { describe, expect, it, vi } from 'vitest'
import { runStackedGitAction } from '../stacked-action-service'
import { makeDeps } from './stacked-action-service.test-harness'

describe('runStackedGitAction change requests', () => {
  it('checks provider authentication before changing a branch, committing, or pushing', async () => {
    const deps = makeDeps({
      preflightChangeRequest: vi.fn(
        async () =>
          ({
            ok: true,
            status: { authenticated: false, account: null, host: null },
          }) as const,
      ),
    })

    const result = await runStackedGitAction(deps, '/repo', {
      action: 'commit_push_pr',
      commitMessage: 'Ship it',
      createFeatureBranch: true,
      featureBranchName: 'codex/provider-preflight',
      paths: ['src/a.ts'],
    })

    expect(result).toMatchObject({
      ok: false,
      phase: 'pr',
      code: 'change-request-failed',
      fallbackUrl: 'https://example.test/new-change-request',
    })
    expect(deps.buildChangeRequestFallbackUrl).toHaveBeenCalledWith(
      '/repo',
      expect.objectContaining({ headRef: 'codex/provider-preflight' }),
      false,
    )
    expect(deps.createBranch).not.toHaveBeenCalled()
    expect(deps.commit).not.toHaveBeenCalled()
    expect(deps.push).not.toHaveBeenCalled()
    expect(deps.openChangeRequest).not.toHaveBeenCalled()
  })

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
    expect(events.map((event) => event.phase)).toEqual(['branch', 'commit', 'push', 'pr'])
    if (result.ok) {
      expect(result.branch).toEqual({ status: 'created', name: 'feature/update' })
      expect(result.commit).toEqual({ ok: true, commitHash: 'abc', summary: 'done' })
      expect(result.changeRequest?.state).toBe('open')
    }
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
    expect(deps.resolveApprovedPushDestination).toHaveBeenCalledWith('/repo', null)
    expect(deps.openChangeRequest).toHaveBeenCalledWith(
      '/repo',
      expect.objectContaining({ headRef: 'feature/current', baseRef: 'main' }),
    )
  })

  it('opens a GitHub fork PR from the branch and owner that actually received the push', async () => {
    const deps = makeDeps({
      resolveApprovedPushDestination: vi.fn(
        async () =>
          ({
            remote: 'fork',
            branch: 'published-name',
            remoteUrl: 'git@github.com:contributor/project.git',
            multiplePushUrls: false,
          }) as const,
      ),
      push: vi.fn(
        async () =>
          ({
            ok: true,
            code: 'ok',
            message: 'pushed',
            destination: {
              remote: 'fork',
              branch: 'published-name',
              remoteUrl: 'git@github.com:contributor/project.git',
              multiplePushUrls: false,
            },
          }) as const,
      ),
    })

    const result = await runStackedGitAction(deps, '/repo', { action: 'create_pr' })

    expect(result.ok).toBe(true)
    expect(deps.openChangeRequest).toHaveBeenCalledWith(
      '/repo',
      expect.objectContaining({
        headRef: 'published-name',
        headOwner: 'contributor',
        targetRepository: {
          provider: 'github',
          host: 'github.com',
          owner: 'upstream',
          repository: 'project',
        },
      }),
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
    const deps = makeDeps({ resolveApprovedPushDestination: vi.fn(async () => null) })
    const result = await runStackedGitAction(deps, '/repo', { action: 'create_pr' })
    expect(result).toMatchObject({ ok: false, phase: 'pr', code: 'change-request-failed' })
    expect(deps.push).not.toHaveBeenCalled()
    expect(deps.openChangeRequest).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'multiple push URLs',
      destination: {
        remote: 'origin',
        branch: 'feature/session-summary',
        remoteUrl: null,
        multiplePushUrls: true,
      },
    },
    {
      name: 'a different provider or host',
      destination: {
        remote: 'fork',
        branch: 'feature/session-summary',
        remoteUrl: 'https://gitlab.com/contributor/project.git',
        multiplePushUrls: false,
      },
    },
  ])('rejects $name before any Git mutation', async ({ destination }) => {
    const deps = makeDeps({
      resolveApprovedPushDestination: vi.fn(async () => destination),
    })

    const result = await runStackedGitAction(deps, '/repo', {
      action: 'commit_push_pr',
      commitMessage: 'Ship it',
      paths: ['src/a.ts'],
      createFeatureBranch: true,
      featureBranchName: 'feature/session-summary',
    })

    expect(result).toMatchObject({
      ok: false,
      phase: 'pr',
      message: expect.stringContaining('not compatible'),
    })
    expect(deps.createBranch).not.toHaveBeenCalled()
    expect(deps.commit).not.toHaveBeenCalled()
    expect(deps.push).not.toHaveBeenCalled()
    expect(deps.openChangeRequest).not.toHaveBeenCalled()
  })

  it('stops before commit when the exact preflighted branch becomes occupied', async () => {
    const deps = makeDeps({
      createBranch: vi.fn(async () => ({ ok: false, message: 'branch already exists' })),
    })

    const result = await runStackedGitAction(deps, '/repo', {
      action: 'commit_push_pr',
      commitMessage: 'Ship it',
      paths: ['src/a.ts'],
      createFeatureBranch: true,
      featureBranchName: 'feature/session-summary',
      exactFeatureBranchName: true,
    })

    expect(result).toMatchObject({ ok: false, phase: 'branch', code: 'branch-failed' })
    expect(deps.createBranch).toHaveBeenCalledWith('/repo', 'feature/session-summary', 'HEAD')
    expect(deps.commit).not.toHaveBeenCalled()
    expect(deps.push).not.toHaveBeenCalled()
    expect(deps.openChangeRequest).not.toHaveBeenCalled()
  })
})
