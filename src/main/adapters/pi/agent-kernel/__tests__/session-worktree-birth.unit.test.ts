import { SessionId } from '@shared/types/brand'
import type { GitWorktreeMutationResult, SessionEnvironmentMode } from '@shared/types/git'
import type { SessionDetail } from '@shared/types/session'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { existsSyncMock, runGitMock, createGitWorktreeMock, setSessionWorktreeMock } = vi.hoisted(
  () => ({
    existsSyncMock: vi.fn(() => true),
    runGitMock: vi.fn(async () => ({ code: 0, stdout: 'main\n', stderr: '' })),
    createGitWorktreeMock: vi.fn(
      async (): Promise<GitWorktreeMutationResult> => ({ ok: true, message: 'ok', path: '/wt' }),
    ),
    setSessionWorktreeMock: vi.fn(async () => {}),
  }),
)

vi.mock('node:fs', () => ({ existsSync: existsSyncMock }))
vi.mock('../../../../ipc/git/shared', () => ({ runGit: runGitMock }))
vi.mock('../../../../ipc/git/worktree-service', () => ({
  createGitWorktree: createGitWorktreeMock,
}))
vi.mock('../../../../store/session-details', () => ({ setSessionWorktree: setSessionWorktreeMock }))

const { ensureSessionWorktreeProjectPath } = await import('../session-worktree-birth')

function session(
  extra: {
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
    existsSyncMock.mockReset().mockReturnValue(true)
    runGitMock.mockReset().mockResolvedValue({ code: 0, stdout: 'main\n', stderr: '' })
    createGitWorktreeMock.mockReset().mockResolvedValue({ ok: true, message: 'ok', path: '/wt' })
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
      expect.objectContaining({ baseRef: 'main', branch: 'ow/session-sess-abc' }),
    )
    expect(setSessionWorktreeMock).toHaveBeenCalledWith(expect.anything(), 'worktree', result)
    expect(result).toContain('/.openwaggle/worktrees/repo/')
  })

  it('uses the chosen Worktree base ref when persisted', async () => {
    await ensureSessionWorktreeProjectPath(
      session({ environmentMode: 'worktree', worktreeBaseRef: 'develop' }),
    )
    expect(createGitWorktreeMock).toHaveBeenCalledWith(
      '/repo',
      expect.objectContaining({ baseRef: 'develop' }),
    )
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
})
