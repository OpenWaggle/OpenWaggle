import { describe, expect, it } from 'vitest'
import {
  resolveDefaultWorktreeBaseRef,
  resolveWorktreeSendPlan,
  WORKTREE_BASE_REF_REQUIRED,
  WORKTREE_MISSING_REASON,
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

  /**
   * A recorded worktree that vanished must stop the send and offer a choice. Silently
   * recreating it would hand the agent an empty tree while the session's earlier work
   * is gone, with nothing in the UI saying so.
   */
  it('blocks the send when the recorded worktree no longer exists', () => {
    expect(
      resolveWorktreeSendPlan({
        isFirstMessage: false,
        envMode: 'worktree',
        hasWorktree: true,
        baseRef: 'main',
        worktreeExists: false,
      }),
    ).toEqual({ kind: 'worktree-missing', reason: WORKTREE_MISSING_REASON })
  })

  it('does not block while worktree existence is still unknown', () => {
    expect(
      resolveWorktreeSendPlan({
        isFirstMessage: false,
        envMode: 'worktree',
        hasWorktree: true,
        baseRef: 'main',
      }),
    ).toEqual({ kind: 'proceed' })
  })

  it('proceeds when the recorded worktree is present', () => {
    expect(
      resolveWorktreeSendPlan({
        isFirstMessage: false,
        envMode: 'worktree',
        hasWorktree: true,
        baseRef: 'main',
        worktreeExists: true,
      }),
    ).toEqual({ kind: 'proceed' })
  })

  // Local mode has no worktree to lose, so a stale recorded path must not block it.
  it('ignores a missing worktree in local mode', () => {
    expect(
      resolveWorktreeSendPlan({
        isFirstMessage: false,
        envMode: 'local',
        hasWorktree: true,
        baseRef: 'main',
        worktreeExists: false,
      }),
    ).toEqual({ kind: 'proceed' })
  })
})
