import { describe, expect, it } from 'vitest'
import {
  resolveDefaultWorktreeBaseRef,
  resolveWorktreeSendPlan,
  WORKTREE_BASE_REF_REQUIRED,
} from '../worktree-send-plan'

describe('resolveWorktreeSendPlan', () => {
  it('proceeds for local-mode sessions', () => {
    expect(
      resolveWorktreeSendPlan({
        isFirstMessage: true,
        envMode: 'local',
        hasWorktree: false,
        baseRef: null,
      }),
    ).toEqual({ kind: 'proceed' })
  })

  it('proceeds when a Session worktree already exists', () => {
    expect(
      resolveWorktreeSendPlan({
        isFirstMessage: true,
        envMode: 'worktree',
        hasWorktree: true,
        baseRef: null,
      }),
    ).toEqual({ kind: 'proceed' })
  })

  it('proceeds for follow-up messages (not the first)', () => {
    expect(
      resolveWorktreeSendPlan({
        isFirstMessage: false,
        envMode: 'worktree',
        hasWorktree: false,
        baseRef: null,
      }),
    ).toEqual({ kind: 'proceed' })
  })

  it('creates a worktree off the chosen base ref on first worktree-mode send', () => {
    expect(
      resolveWorktreeSendPlan({
        isFirstMessage: true,
        envMode: 'worktree',
        hasWorktree: false,
        baseRef: 'main',
      }),
    ).toEqual({ kind: 'create-worktree', baseRef: 'main' })
  })

  it('trims the base ref before use', () => {
    expect(
      resolveWorktreeSendPlan({
        isFirstMessage: true,
        envMode: 'worktree',
        hasWorktree: false,
        baseRef: '  develop  ',
      }),
    ).toEqual({ kind: 'create-worktree', baseRef: 'develop' })
  })

  it('blocks the send when no base ref is resolvable', () => {
    expect(
      resolveWorktreeSendPlan({
        isFirstMessage: true,
        envMode: 'worktree',
        hasWorktree: false,
        baseRef: '   ',
      }),
    ).toEqual({ kind: 'blocked', reason: WORKTREE_BASE_REF_REQUIRED })
  })
})

describe('resolveDefaultWorktreeBaseRef', () => {
  it('defaults to the current branch when resolvable', () => {
    expect(resolveDefaultWorktreeBaseRef({ currentBranch: 'main' })).toBe('main')
  })

  it('returns null on detached HEAD / unknown branch', () => {
    expect(resolveDefaultWorktreeBaseRef({ currentBranch: null })).toBeNull()
    expect(resolveDefaultWorktreeBaseRef({ currentBranch: '  ' })).toBeNull()
    expect(resolveDefaultWorktreeBaseRef(null)).toBeNull()
  })
})
