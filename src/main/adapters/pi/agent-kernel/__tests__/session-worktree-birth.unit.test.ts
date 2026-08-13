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
vi.mock('../../../git/run-git', () => ({ runGit: runGitMock }))
vi.mock('../../../git/worktree', () => ({
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

  /**
   * Ground truth for a vanished worktree: the recorded path no longer exists on disk.
   * The agent must never fall back to the user's opened checkout, which is the
   * isolation worktree mode exists to provide. A fresh worktree is created instead.
   */
  it('recreates a vanished worktree instead of falling back to the opened checkout', async () => {
    existsSyncMock.mockReturnValue(false)
    createGitWorktreeMock.mockResolvedValue({ ok: true, message: 'ok', path: '/wt/new' })

    const resolved = await ensureSessionWorktreeProjectPath(
      session({ environmentMode: 'worktree', worktreePath: '/wt/gone', worktreeBaseRef: 'main' }),
    )

    expect(resolved).not.toBe('/repo')
    expect(createGitWorktreeMock).toHaveBeenCalled()
    expect(setSessionWorktreeMock).toHaveBeenCalled()
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

  it('serializes concurrent births so the worktree is only created once (M5)', async () => {
    existsSyncMock.mockReturnValue(false)
    const s = session({ environmentMode: 'worktree' })
    const [a, b] = await Promise.all([
      ensureSessionWorktreeProjectPath(s),
      ensureSessionWorktreeProjectPath(s),
    ])
    expect(a).toBe(b)
    expect(createGitWorktreeMock).toHaveBeenCalledTimes(1)
  })
})
