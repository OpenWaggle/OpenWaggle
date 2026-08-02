import { SessionId } from '@shared/types/brand'
import type { SessionEnvironmentMode } from '@shared/types/git'
import type { SessionDetail } from '@shared/types/session'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { existsSyncMock } = vi.hoisted(() => ({ existsSyncMock: vi.fn(() => true) }))

vi.mock('node:fs', () => ({ existsSync: existsSyncMock }))

const { resolveSessionProjectPath } = await import('../session-manager')

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
    expect(resolveSessionProjectPath(session('/repo'))).toBe('/repo')
    expect(() => resolveSessionProjectPath(session(null))).toThrow(
      'No project path set on the session - cannot run Pi agent',
    )
  })

  it('uses the opened checkout for local-mode sessions (default)', () => {
    expect(resolveSessionProjectPath(session('/repo', { environmentMode: 'local' }))).toBe('/repo')
    expect(resolveSessionProjectPath(session('/repo', { worktreePath: '/wt/x' }))).toBe('/repo')
  })

  it('uses the Session worktree path for worktree-mode sessions when it exists', () => {
    expect(
      resolveSessionProjectPath(
        session('/repo', { environmentMode: 'worktree', worktreePath: '/wt/x' }),
      ),
    ).toBe('/wt/x')
  })

  it('falls back to the checkout when the worktree path is missing on disk', () => {
    existsSyncMock.mockReturnValue(false)
    expect(
      resolveSessionProjectPath(
        session('/repo', { environmentMode: 'worktree', worktreePath: '/wt/gone' }),
      ),
    ).toBe('/repo')
  })
})
