import { describe, expect, it } from 'vitest'
import { projectActionWorktreeMode } from '../useRunProjectAction'

describe('project action worktree context', () => {
  it('requires a materialized worktree path before adding worktree variables', () => {
    expect(projectActionWorktreeMode(null)).toBe(false)
    expect(projectActionWorktreeMode({ environmentMode: 'local', worktreePath: '/worktree' })).toBe(
      false,
    )
    expect(projectActionWorktreeMode({ environmentMode: 'worktree', worktreePath: null })).toBe(
      false,
    )
    expect(projectActionWorktreeMode({ environmentMode: 'worktree', worktreePath: '' })).toBe(false)
    expect(
      projectActionWorktreeMode({ environmentMode: 'worktree', worktreePath: '/worktree' }),
    ).toBe(true)
  })
})
