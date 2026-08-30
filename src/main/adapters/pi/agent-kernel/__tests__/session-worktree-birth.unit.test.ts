import { SessionId } from '@shared/types/brand'
import type { GitWorktreeMutationResult, SessionEnvironmentMode } from '@shared/types/git'
import type { SessionDetail } from '@shared/types/session'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoundWorkspaceResource } from '../../../../store/session-details'
import { unrelatedWorktreeGitResult } from './session-worktree-birth-test-helpers'

const {
  existsSyncMock,
  runGitMock,
  createGitWorktreeMock,
  applyWorkspaceHandoffSeedMock,
  releaseWorkspaceHandoffSeedMock,
  getBoundWorkspaceResourceMock,
  setSessionWorktreeMock,
} = vi.hoisted(() => ({
  existsSyncMock: vi.fn((_candidate: string) => true),
  runGitMock: vi.fn(async (_cwd: string, _args: readonly string[]) => ({
    code: 0,
    stdout: 'main\n',
    stderr: '',
  })),
  createGitWorktreeMock: vi.fn(
    async (): Promise<GitWorktreeMutationResult> => ({ ok: true, message: 'ok', path: '/wt' }),
  ),
  applyWorkspaceHandoffSeedMock: vi.fn(async () => {}),
  releaseWorkspaceHandoffSeedMock: vi.fn(async () => {}),
  getBoundWorkspaceResourceMock: vi.fn<() => Promise<BoundWorkspaceResource | null>>(async () =>
    Promise.resolve(null),
  ),
  setSessionWorktreeMock: vi.fn(async () => {}),
}))

vi.mock('node:fs', () => ({ existsSync: existsSyncMock }))
vi.mock('../../../git/run-git', () => ({ runGit: runGitMock }))
vi.mock('../../../git/worktree', () => ({
  createGitWorktree: createGitWorktreeMock,
}))
vi.mock('../../../git/workspace-handoff-snapshot', () => ({
  applyWorkspaceHandoffSeed: applyWorkspaceHandoffSeedMock,
  releaseWorkspaceHandoffSeed: releaseWorkspaceHandoffSeedMock,
}))
vi.mock('../../../../store/session-details', () => ({
  getBoundWorkspaceResource: getBoundWorkspaceResourceMock,
  setSessionWorktree: setSessionWorktreeMock,
  validateSessionWorktreeBirthAuthority: vi.fn(async () => {}),
}))

const { ensureSessionWorktreeProjectPath } = await import('../session-worktree-birth')

function session(
  extra: {
    id?: SessionId
    environmentMode?: SessionEnvironmentMode
    worktreePath?: string | null
    worktreeBaseRef?: string | null
    worktreeStartFromOrigin?: boolean
  } = {},
): SessionDetail {
  return {
    id: SessionId('sess-abcdef12'),
    title: 'S',
    projectPath: '/repo',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  }
}

describe('ensureSessionWorktreeProjectPath', () => {
  beforeEach(() => {
    existsSyncMock
      .mockReset()
      .mockImplementation((candidate: string) => !candidate.includes('/.openwaggle/worktrees/'))
    runGitMock.mockReset().mockResolvedValue({ code: 0, stdout: 'main\n', stderr: '' })
    createGitWorktreeMock.mockReset().mockResolvedValue({ ok: true, message: 'ok', path: '/wt' })
    applyWorkspaceHandoffSeedMock.mockReset().mockResolvedValue(undefined)
    releaseWorkspaceHandoffSeedMock.mockReset().mockResolvedValue(undefined)
    getBoundWorkspaceResourceMock.mockReset().mockResolvedValue(null)
    setSessionWorktreeMock.mockReset().mockResolvedValue(undefined)
  })

  it('returns the opened checkout for local-mode sessions without creating a worktree', async () => {
    await expect(
      ensureSessionWorktreeProjectPath(session({ environmentMode: 'local' })),
    ).resolves.toBe('/repo')
    expect(createGitWorktreeMock).not.toHaveBeenCalled()
  })

  it('reuses an existing worktree path in worktree mode', async () => {
    const result = await ensureSessionWorktreeProjectPath(
      session({ environmentMode: 'worktree', worktreePath: '/wt/existing' }),
    )
    expect(result).toBe('/wt/existing')
    expect(createGitWorktreeMock).not.toHaveBeenCalled()
  })

  it('creates and persists a worktree on first send in worktree mode', async () => {
    createGitWorktreeMock.mockResolvedValue({ ok: true, message: 'ok', path: '/ignored' })
    const result = await ensureSessionWorktreeProjectPath(session({ environmentMode: 'worktree' }))
    expect(createGitWorktreeMock).toHaveBeenCalledWith(
      '/repo',
      expect.objectContaining({ baseRef: 'main', branch: 'ow/session-sess-abcdef12' }),
    )
    expect(setSessionWorktreeMock).toHaveBeenCalledWith(
      expect.anything(),
      'worktree',
      result,
      'ow/session-sess-abcdef12',
    )
    expect(result).toContain('/.openwaggle/worktrees/repo/')
  })

  it('reports the real first-send Git stages with branch and base-ref details', async () => {
    const onProgress = vi.fn()

    const result = await ensureSessionWorktreeProjectPath(
      session({ environmentMode: 'worktree', worktreeBaseRef: 'develop' }),
      { onProgress },
    )

    expect(onProgress.mock.calls).toEqual([
      [{ stage: 'preparing-workspace', details: ['Preparing the session worktree'] }],
      [
        {
          stage: 'checking-out-files',
          details: ['Creating ow/session-sess-abcdef12 from develop'],
          branch: 'ow/session-sess-abcdef12',
          baseRef: 'develop',
          worktreePath: result,
        },
      ],
      [
        {
          stage: 'worktree-created',
          details: ['Created ow/session-sess-abcdef12 from develop'],
          branch: 'ow/session-sess-abcdef12',
          baseRef: 'develop',
          worktreePath: result,
        },
      ],
    ])
  })

  it('passes the run cancellation signal into worktree creation', async () => {
    const controller = new AbortController()

    await ensureSessionWorktreeProjectPath(session({ environmentMode: 'worktree' }), {
      signal: controller.signal,
    })

    expect(createGitWorktreeMock).toHaveBeenCalledWith('/repo', expect.anything(), {
      signal: controller.signal,
    })
  })

  it('adopts the worktree on a repeat call with a stale session record instead of recreating it', async () => {
    const stale = session({ environmentMode: 'worktree' })
    let created = false
    existsSyncMock.mockImplementation((candidate: string) => {
      if (candidate.includes('/.openwaggle/worktrees/')) return created
      return true
    })
    createGitWorktreeMock.mockImplementation(() => {
      created = true
      return Promise.resolve({ ok: true, message: 'ok', path: '/ignored' })
    })

    const first = await ensureSessionWorktreeProjectPath(stale)
    const second = await ensureSessionWorktreeProjectPath(stale)

    expect(second).toBe(first)
    expect(createGitWorktreeMock).toHaveBeenCalledTimes(1)
  })

  it('forks from origin/<base> when start-from-origin is set', async () => {
    await ensureSessionWorktreeProjectPath(
      session({
        environmentMode: 'worktree',
        worktreeBaseRef: 'main',
        worktreeStartFromOrigin: true,
      }),
    )
    expect(createGitWorktreeMock).toHaveBeenCalledWith(
      '/repo',
      expect.objectContaining({ baseRef: 'origin/main' }),
    )
  })

  it('refuses to run when the recorded worktree has vanished', async () => {
    existsSyncMock.mockReturnValue(false)

    await expect(
      ensureSessionWorktreeProjectPath(
        session({ environmentMode: 'worktree', worktreePath: '/wt/gone', worktreeBaseRef: 'main' }),
      ),
    ).rejects.toThrow(/no longer exists/)

    expect(createGitWorktreeMock).not.toHaveBeenCalled()
  })

  it('throws (no silent fallback) when worktree creation fails in worktree mode', async () => {
    createGitWorktreeMock.mockResolvedValue({ ok: false, code: 'unknown', message: 'boom' })
    await expect(
      ensureSessionWorktreeProjectPath(session({ environmentMode: 'worktree' })),
    ).rejects.toThrow(/Could not create a worktree/)
    expect(setSessionWorktreeMock).not.toHaveBeenCalled()
  })

  it('throws when no base branch is resolvable (detached HEAD)', async () => {
    runGitMock.mockResolvedValue({ code: 1, stdout: '', stderr: '' })
    await expect(
      ensureSessionWorktreeProjectPath(session({ environmentMode: 'worktree' })),
    ).rejects.toThrow(/no base branch is resolvable/)
    expect(createGitWorktreeMock).not.toHaveBeenCalled()
  })

  it('keys shared worktree birth by Workspace identity rather than one member Session', async () => {
    existsSyncMock.mockReturnValue(false)
    getBoundWorkspaceResourceMock.mockResolvedValue({
      id: 'workspace-shared',
      projectPath: '/repo',
      kind: 'managed-worktree',
      workingPath: '/managed/workspace-shared',
      lifecycleState: 'pending',
      worktreeBranch: 'ow/session-workspace-shared',
      worktreeBaseRef: 'main',
      worktreeStartFromOrigin: false,
      handoffSeedRef: null,
      handoffSeedBaseRef: null,
      handoffSeedState: 'none',
    })

    const [first, second] = await Promise.all([
      ensureSessionWorktreeProjectPath(
        session({ id: SessionId('session-one'), environmentMode: 'worktree' }),
      ),
      ensureSessionWorktreeProjectPath(
        session({ id: SessionId('session-two'), environmentMode: 'worktree' }),
      ),
    ])

    expect(first).toBe('/managed/workspace-shared')
    expect(second).toBe(first)
    expect(createGitWorktreeMock).toHaveBeenCalledOnce()
    expect(createGitWorktreeMock).toHaveBeenCalledWith('/repo', {
      path: '/managed/workspace-shared',
      branch: 'ow/session-workspace-shared',
      baseRef: 'main',
    })
  })

  it('applies a durable handoff seed before publishing the Workspace as ready', async () => {
    existsSyncMock.mockReturnValue(false)
    getBoundWorkspaceResourceMock.mockResolvedValue({
      id: 'workspace-seeded',
      projectPath: '/repo',
      kind: 'managed-worktree',
      workingPath: '/managed/workspace-seeded',
      lifecycleState: 'pending',
      worktreeBranch: 'ow/session-workspace-seeded',
      worktreeBaseRef: 'head-sha',
      worktreeStartFromOrigin: false,
      handoffSeedRef: 'refs/openwaggle/workspace-handoffs/workspace-seeded',
      handoffSeedBaseRef: 'head-sha',
      handoffSeedState: 'pending',
    })

    await ensureSessionWorktreeProjectPath(session({ environmentMode: 'worktree' }))

    expect(applyWorkspaceHandoffSeedMock).toHaveBeenCalledWith({
      projectPath: '/repo',
      workingPath: '/managed/workspace-seeded',
      sourceHead: 'head-sha',
      snapshotRef: 'refs/openwaggle/workspace-handoffs/workspace-seeded',
    })
    expect(applyWorkspaceHandoffSeedMock.mock.invocationCallOrder[0]).toBeLessThan(
      setSessionWorktreeMock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )
    expect(releaseWorkspaceHandoffSeedMock).toHaveBeenCalledOnce()
  })

  it('retries a cancelled in-flight birth for a replacement send with a live signal', async () => {
    existsSyncMock.mockReturnValue(false)
    const cancelledController = new AbortController()
    const replacementController = new AbortController()
    const cancelledBirth: { reject: (reason?: unknown) => void } = {
      reject: () => undefined,
    }
    createGitWorktreeMock
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            cancelledBirth.reject = reject
          }),
      )
      .mockResolvedValueOnce({ ok: true, message: 'ok', path: '/wt' })

    const cancelled = ensureSessionWorktreeProjectPath(session({ environmentMode: 'worktree' }), {
      signal: cancelledController.signal,
    })
    await vi.waitFor(() => expect(createGitWorktreeMock).toHaveBeenCalledTimes(1))

    cancelledController.abort()
    const replacement = ensureSessionWorktreeProjectPath(session({ environmentMode: 'worktree' }), {
      signal: replacementController.signal,
    })
    cancelledBirth.reject(cancelledController.signal.reason)

    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    await expect(replacement).resolves.toContain('/.openwaggle/worktrees/repo/')
    expect(createGitWorktreeMock).toHaveBeenCalledTimes(2)
  })

  it('does not adopt a directory that is not a worktree of this repository', async () => {
    existsSyncMock.mockReset().mockReturnValue(true)
    runGitMock.mockReset().mockImplementation(unrelatedWorktreeGitResult)
    await expect(
      ensureSessionWorktreeProjectPath(session({ environmentMode: 'worktree' })),
    ).rejects.toThrow(/already exists and is not a worktree/)

    expect(createGitWorktreeMock).not.toHaveBeenCalled()
  })

  it('treats a recorded path that is no longer a worktree as missing, rather than using it', async () => {
    existsSyncMock.mockReset().mockReturnValue(true)
    runGitMock.mockReset().mockImplementation(unrelatedWorktreeGitResult)

    await expect(
      ensureSessionWorktreeProjectPath(
        session({ environmentMode: 'worktree', worktreePath: '/stale/tree' }),
      ),
    ).rejects.toThrow(/no longer exists|not a worktree/)
  })
})
