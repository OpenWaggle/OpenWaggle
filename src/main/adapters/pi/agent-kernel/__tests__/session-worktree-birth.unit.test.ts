import { SessionId } from '@shared/types/brand'
import type { GitWorktreeMutationResult, SessionEnvironmentMode } from '@shared/types/git'
import type { SessionDetail } from '@shared/types/session'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { existsSyncMock, runGitMock, createGitWorktreeMock, setSessionWorktreeMock } = vi.hoisted(
  () => ({
    existsSyncMock: vi.fn((_candidate: string) => true),
    runGitMock: vi.fn(async (_cwd: string, _args: readonly string[]) => ({
      code: 0,
      stdout: 'main\n',
      stderr: '',
    })),
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
    /*
     * Default to "exists", except the deterministic birth path, which by definition does not
     * exist before the first send. Blanket `true` made the first-send tests unrealistic and
     * hid the adopt-on-repeat behaviour below.
     */
    existsSyncMock
      .mockReset()
      .mockImplementation((candidate: string) => !candidate.includes('/.openwaggle/worktrees/'))
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
      expect.objectContaining({ baseRef: 'main', branch: 'ow/session-sess-abcdef12' }),
    )
    expect(setSessionWorktreeMock).toHaveBeenCalledWith(expect.anything(), 'worktree', result)
    expect(result).toContain('/.openwaggle/worktrees/repo/')
  })

  it('adopts the worktree on a repeat call with a stale session record instead of recreating it', async () => {
    /*
     * Regression for a critical defect: birth persists the new path with SQL but does not
     * mutate the SessionDetail it was handed, so a caller holding a pre-birth copy still sees
     * `worktreePath: null`. Creating again failed - the directory exists and the branch is
     * already checked out there - which broke the first send of every worktree-mode session.
     */
    const stale = session({ environmentMode: 'worktree' })
    // The deterministic path does not exist yet, then does once the first call created it.
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
   * A vanished worktree must not be silently replaced: the fresh tree would not hold
   * what the old one did, and the user would never be told. The composer blocks the
   * send and offers recreate-or-switch, so reaching here means that gate was bypassed
   * and refusing is the only safe answer. It must never resolve to the opened checkout.
   */
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

  it('does not adopt a directory that is not a worktree of this repository', async () => {
    /*
     * A directory left at the deterministic path after the repository was moved or re-cloned was
     * adopted on existence alone and recorded as the session's tree. The agent then ran with a cwd
     * where every git command failed, turn capture silently no-opped, and the diff panel reported
     * "not a Git repository".
     */
    existsSyncMock.mockReset().mockReturnValue(true)
    runGitMock.mockReset().mockImplementation((cwd: string, args: readonly string[]) => {
      if (args[0] === 'rev-parse' && args.includes('--git-common-dir')) {
        // The candidate belongs to a different repository than the opened checkout.
        return Promise.resolve({
          code: 0,
          stdout: cwd === '/repo' ? '/repo/.git\n' : '/elsewhere/.git\n',
          stderr: '',
        })
      }
      return Promise.resolve({ code: 0, stdout: 'main\n', stderr: '' })
    })

    await ensureSessionWorktreeProjectPath(session({ environmentMode: 'worktree' }))

    // Creation happened instead of adoption.
    expect(createGitWorktreeMock).toHaveBeenCalledTimes(1)
  })
})
