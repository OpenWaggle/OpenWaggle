import { SessionId } from '@shared/types/brand'
import type { SessionEnvironmentMode } from '@shared/types/git'
import type { SessionDetail } from '@shared/types/session'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { existsSyncMock } = vi.hoisted(() => ({ existsSyncMock: vi.fn(() => true) }))

vi.mock('node:fs', () => ({ existsSync: existsSyncMock }))

const { requireSessionProjectPath, resolveSessionWorkingPath } = await import('../session-manager')

function session(
  projectPath: string | null,
  extra: { environmentMode?: SessionEnvironmentMode; worktreePath?: string | null } = {},
) {
  return {
    id: SessionId('session-1'),
    title: 'Session',
    projectPath,
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  } satisfies SessionDetail
}

describe('Pi session manager helpers', () => {
  beforeEach(() => {
    existsSyncMock.mockReset()
    existsSyncMock.mockReturnValue(true)
  })

  it('requires a concrete project path before creating Pi sessions', () => {
    expect(resolveSessionWorkingPath(session('/repo'))).toBe('/repo')
    expect(() => resolveSessionWorkingPath(session(null))).toThrow(
      'No project path set on the session - cannot run Pi agent',
    )
  })

  it('uses the opened checkout for local-mode sessions (default)', () => {
    expect(resolveSessionWorkingPath(session('/repo', { environmentMode: 'local' }))).toBe('/repo')
    expect(resolveSessionWorkingPath(session('/repo', { worktreePath: '/wt/x' }))).toBe('/repo')
  })

  it('uses the Session worktree path for worktree-mode sessions when it exists', () => {
    expect(
      resolveSessionWorkingPath(
        session('/repo', { environmentMode: 'worktree', worktreePath: '/wt/x' }),
      ),
    ).toBe('/wt/x')
  })

  /**
   * The fallback this replaces was silent, and its effect was to hand the Pi agent the
   * user's own checkout as its working directory — deleting the isolation that worktree
   * mode exists to provide, with nothing in the UI saying so. It must never resolve to
   * the opened checkout for a worktree-mode session whose worktree is gone.
   */
  it('refuses rather than silently using the checkout when the worktree is gone', () => {
    existsSyncMock.mockReturnValue(false)
    const vanished = session('/repo', { environmentMode: 'worktree', worktreePath: '/wt/gone' })

    expect(() => resolveSessionWorkingPath(vanished)).toThrow(/no longer exists/)
  })

  /*
   * Worktree birth creates the worktree FROM the primary checkout, so it must never be
   * handed a worktree path. These were one function until the primary-path caller was
   * found to be relying on call ordering to get the checkout back.
   */
  it('requireSessionProjectPath returns the checkout even for a live worktree session', () => {
    existsSyncMock.mockReturnValue(true)
    const worktreeSession = session('/repo', {
      environmentMode: 'worktree',
      worktreePath: '/wt/x',
    })

    expect(requireSessionProjectPath(worktreeSession)).toBe('/repo')
    expect(resolveSessionWorkingPath(worktreeSession)).toBe('/wt/x')
  })

  it('requireSessionProjectPath still rejects a session with no project', () => {
    expect(() => requireSessionProjectPath(session(null))).toThrow(
      'No project path set on the session - cannot run Pi agent',
    )
  })
})
