import { SessionId } from '@shared/types/brand'
import type { GitWorktreeMutationResult } from '@shared/types/git'
import type { SessionDetail } from '@shared/types/session'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ClaimedSessionWorktreeSetup,
  PendingSessionWorktreeSetup,
} from '../../../../store/session-details'
import { reportAcceptedSetupActionProgress } from '../project-setup-action-progress'

const {
  adoptSessionWorktreeForSetupMock,
  claimSessionWorktreeSetupMock,
  completeSessionWorktreeSetupMock,
  existsSyncMock,
  getSessionWorktreeSetupDispatchMock,
  releaseSessionWorktreeSetupClaimMock,
  resetSessionWorktreeSetupMock,
  runGitMock,
  createGitWorktreeMock,
  setSessionWorktreeMock,
} = vi.hoisted(() => ({
  adoptSessionWorktreeForSetupMock: vi.fn(),
  claimSessionWorktreeSetupMock: vi.fn(),
  completeSessionWorktreeSetupMock: vi.fn(async () => undefined),
  existsSyncMock: vi.fn((_candidate: string) => false),
  getSessionWorktreeSetupDispatchMock: vi.fn(),
  releaseSessionWorktreeSetupClaimMock: vi.fn(async () => undefined),
  resetSessionWorktreeSetupMock: vi.fn(),
  runGitMock: vi.fn(async (_cwd: string, _args: readonly string[]) => ({
    code: 0,
    stdout: 'main\n',
    stderr: '',
  })),
  createGitWorktreeMock: vi.fn(
    async (): Promise<GitWorktreeMutationResult> => ({ ok: true, message: 'ok', path: '/wt' }),
  ),
  setSessionWorktreeMock: vi.fn(async () => undefined),
}))

vi.mock('node:fs', () => ({ existsSync: existsSyncMock }))
vi.mock('../../../git/run-git', () => ({ runGit: runGitMock }))
vi.mock('../../../git/worktree', () => ({ createGitWorktree: createGitWorktreeMock }))
vi.mock('../../../../store/session-details', () => ({
  adoptSessionWorktreeForSetup: adoptSessionWorktreeForSetupMock,
  claimSessionWorktreeSetup: claimSessionWorktreeSetupMock,
  completeSessionWorktreeSetup: completeSessionWorktreeSetupMock,
  getSessionWorktreeSetupDispatch: getSessionWorktreeSetupDispatchMock,
  releaseSessionWorktreeSetupClaim: releaseSessionWorktreeSetupClaimMock,
  resetSessionWorktreeSetup: resetSessionWorktreeSetupMock,
  setSessionWorktree: setSessionWorktreeMock,
}))

const { ensureSessionWorktreeProjectPath } = await import('../session-worktree-birth')

function session(extra: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: SessionId('setup-session'),
    title: 'Setup session',
    projectPath: '/repo',
    environmentMode: 'worktree',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  }
}

describe('new-worktree post-persistence launch hook', () => {
  beforeEach(() => {
    adoptSessionWorktreeForSetupMock.mockReset().mockResolvedValue(null)
    claimSessionWorktreeSetupMock
      .mockReset()
      .mockImplementation(async (_id: SessionId, pending: PendingSessionWorktreeSetup) =>
        Promise.resolve({
          ...pending,
          state: 'claimed',
          claimToken: 'claim-1',
        } satisfies ClaimedSessionWorktreeSetup),
      )
    completeSessionWorktreeSetupMock.mockReset().mockResolvedValue(undefined)
    existsSyncMock.mockReset().mockReturnValue(false)
    getSessionWorktreeSetupDispatchMock.mockReset().mockResolvedValue(null)
    releaseSessionWorktreeSetupClaimMock.mockReset().mockResolvedValue(undefined)
    resetSessionWorktreeSetupMock.mockReset().mockImplementation(async (_id, worktreePath) => ({
      worktreePath,
      generation: 'generation-1',
      state: 'pending',
    }))
    runGitMock.mockReset().mockResolvedValue({ code: 0, stdout: 'main\n', stderr: '' })
    createGitWorktreeMock.mockReset().mockResolvedValue({ ok: true, message: 'ok', path: '/wt' })
    setSessionWorktreeMock.mockReset().mockResolvedValue(undefined)
  })

  it('claims the generation before launch after a newly created worktree is persisted', async () => {
    const onSetupPending = vi.fn(async () => undefined)

    await ensureSessionWorktreeProjectPath(session(), { onSetupPending })

    expect(onSetupPending).toHaveBeenCalledOnce()
    expect(setSessionWorktreeMock).toHaveBeenCalledBefore(onSetupPending)
    expect(claimSessionWorktreeSetupMock).toHaveBeenCalledBefore(onSetupPending)
    expect(onSetupPending).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryPath: '/repo',
        branch: 'ow/session-setup-session',
        baseRef: 'main',
        setupGeneration: 'generation-1',
      }),
    )
    expect(completeSessionWorktreeSetupMock).toHaveBeenCalledWith(SessionId('setup-session'), {
      worktreePath: expect.stringContaining('/.openwaggle/worktrees/repo/setup-session'),
      generation: 'generation-1',
      state: 'claimed',
      claimToken: 'claim-1',
    })
  })

  it('does not run for completed recorded, recovered, or local workspaces', async () => {
    const onSetupPending = vi.fn(async () => undefined)
    existsSyncMock.mockReturnValue(true)
    runGitMock.mockResolvedValue({ code: 0, stdout: '/repo/.git\n', stderr: '' })

    await ensureSessionWorktreeProjectPath(session({ worktreePath: '/recorded/worktree' }), {
      onSetupPending,
    })
    await ensureSessionWorktreeProjectPath(session(), { onSetupPending })
    await ensureSessionWorktreeProjectPath(session({ environmentMode: 'local' }), {
      onSetupPending,
    })

    expect(onSetupPending).not.toHaveBeenCalled()
    expect(createGitWorktreeMock).not.toHaveBeenCalled()
  })

  it('contains hook failure, records it in progress, and still resolves the worktree', async () => {
    const onProgress = vi.fn()

    await expect(
      ensureSessionWorktreeProjectPath(session(), {
        onProgress,
        onSetupPending: async () => {
          throw new Error('setup queue unavailable')
        },
      }),
    ).resolves.toContain('/.openwaggle/worktrees/repo/')
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'worktree-created',
        details: ['Project Setup action did not start: setup queue unavailable'],
      }),
    )
    expect(completeSessionWorktreeSetupMock).not.toHaveBeenCalled()
    expect(releaseSessionWorktreeSetupClaimMock).toHaveBeenCalledOnce()
  })

  it('shares concurrent birth and launch work without duplicating setup', async () => {
    const onSetupPending = vi.fn(async () => undefined)
    const current = session()

    await Promise.all([
      ensureSessionWorktreeProjectPath(current, { onSetupPending }),
      ensureSessionWorktreeProjectPath(current, { onSetupPending }),
    ])

    expect(createGitWorktreeMock).toHaveBeenCalledOnce()
    expect(onSetupPending).toHaveBeenCalledOnce()
  })

  it('retries a failed pending Setup dispatch on the next send', async () => {
    const pending = { worktreePath: '/recorded/worktree', generation: 'recreate-1' }
    const onSetupPending = vi
      .fn()
      .mockRejectedValueOnce(new Error('terminal open failed'))
      .mockResolvedValueOnce(undefined)
    existsSyncMock.mockReturnValue(true)
    runGitMock.mockResolvedValue({ code: 0, stdout: '/repo/.git\n', stderr: '' })
    getSessionWorktreeSetupDispatchMock.mockResolvedValue({ ...pending, state: 'pending' })

    const recreated = session({ worktreePath: pending.worktreePath })
    await ensureSessionWorktreeProjectPath(recreated, { onSetupPending })
    await ensureSessionWorktreeProjectPath(recreated, { onSetupPending })

    expect(onSetupPending).toHaveBeenCalledTimes(2)
    expect(onSetupPending).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ setupGeneration: 'recreate-1' }),
    )
    expect(completeSessionWorktreeSetupMock).toHaveBeenCalledOnce()
    expect(releaseSessionWorktreeSetupClaimMock).toHaveBeenCalledOnce()
  })

  it('recovers an aborted post-Git birth and dispatches Setup during adoption', async () => {
    const controller = new AbortController()
    let created = false
    existsSyncMock.mockImplementation((candidate: string) => {
      if (candidate.includes('/.openwaggle/worktrees/')) return created
      return true
    })
    createGitWorktreeMock.mockImplementation(async () => {
      created = true
      controller.abort(new DOMException('run cancelled', 'AbortError'))
      return { ok: true, message: 'ok', path: '/ignored' }
    })

    await expect(
      ensureSessionWorktreeProjectPath(session(), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })

    const worktreePath = resetSessionWorktreeSetupMock.mock.calls[0]?.[1]
    if (!worktreePath) throw new Error('worktree setup was not made pending')
    adoptSessionWorktreeForSetupMock.mockResolvedValue({
      worktreePath,
      generation: 'generation-1',
      state: 'pending',
    })
    const onSetupPending = vi.fn(async () => undefined)
    await ensureSessionWorktreeProjectPath(session(), { onSetupPending })

    expect(setSessionWorktreeMock).not.toHaveBeenCalled()
    expect(adoptSessionWorktreeForSetupMock).toHaveBeenCalledWith(
      SessionId('setup-session'),
      expect.stringContaining('/.openwaggle/worktrees/repo/setup-session'),
    )
    expect(onSetupPending).toHaveBeenCalledWith(
      expect.objectContaining({ setupGeneration: 'generation-1' }),
    )
    expect(completeSessionWorktreeSetupMock).toHaveBeenCalledWith(SessionId('setup-session'), {
      worktreePath,
      generation: 'generation-1',
      state: 'claimed',
      claimToken: 'claim-1',
    })
  })

  it('preserves a completed generation when a stale Session copy adopts its recorded tree', async () => {
    const onSetupPending = vi.fn(async () => undefined)
    existsSyncMock.mockReturnValue(true)
    runGitMock.mockResolvedValue({ code: 0, stdout: '/repo/.git\n', stderr: '' })
    adoptSessionWorktreeForSetupMock.mockResolvedValue(null)

    await ensureSessionWorktreeProjectPath(session(), { onSetupPending })

    expect(onSetupPending).not.toHaveBeenCalled()
    expect(completeSessionWorktreeSetupMock).not.toHaveBeenCalled()
  })

  it('does not replay a claim left by an interrupted app process', async () => {
    const onProgress = vi.fn()
    const onSetupPending = vi.fn(async () => undefined)
    existsSyncMock.mockReturnValue(true)
    runGitMock.mockResolvedValue({ code: 0, stdout: '/repo/.git\n', stderr: '' })
    getSessionWorktreeSetupDispatchMock.mockResolvedValue({
      worktreePath: '/recorded/worktree',
      generation: 'generation-before-crash',
      state: 'claimed',
      claimToken: 'claim-before-crash',
    })

    await ensureSessionWorktreeProjectPath(session({ worktreePath: '/recorded/worktree' }), {
      onProgress,
      onSetupPending,
    })

    expect(onSetupPending).not.toHaveBeenCalled()
    expect(claimSessionWorktreeSetupMock).not.toHaveBeenCalled()
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        details: [expect.stringContaining('was not started again automatically')],
      }),
    )
  })

  it('keeps a durable claim when acceptance-receipt finalization fails', async () => {
    const onProgress = vi.fn()
    const onSetupPending = vi.fn(async () => undefined)
    completeSessionWorktreeSetupMock.mockRejectedValueOnce(new Error('database unavailable'))

    await ensureSessionWorktreeProjectPath(session(), { onProgress, onSetupPending })

    expect(onSetupPending).toHaveBeenCalledOnce()
    expect(releaseSessionWorktreeSetupClaimMock).not.toHaveBeenCalled()
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        details: [expect.stringContaining('will not be started again automatically')],
      }),
    )
  })

  it('finalizes an accepted claim when its later progress listener throws', async () => {
    const report = vi.fn(() => {
      throw new Error('progress listener failed')
    })
    const onSetupPending = vi.fn(async () => {
      reportAcceptedSetupActionProgress({
        sessionId: 'setup-session',
        report,
        progress: {
          stage: 'worktree-created',
          details: ['Started Setup action "Install dependencies"'],
          worktreePath: '/worktree',
        },
      })
    })

    await ensureSessionWorktreeProjectPath(session(), { onSetupPending })

    expect(report).toHaveBeenCalledOnce()
    expect(completeSessionWorktreeSetupMock).toHaveBeenCalledOnce()
    expect(releaseSessionWorktreeSetupClaimMock).not.toHaveBeenCalled()
  })
})
