import { describe, expect, it } from 'vitest'
import { resolveWorktreeSendPlan } from '../worktree-send-plan'

describe('resolveWorktreeSendPlan', () => {
  it('uses the opened checkout in local mode', () => {
    expect(
      resolveWorktreeSendPlan({ mode: 'local', baseRef: null, existingWorktreePath: null }),
    ).toEqual({ kind: 'use-checkout' })
  })

  it('reuses an existing worktree in worktree mode', () => {
    expect(
      resolveWorktreeSendPlan({ mode: 'worktree', baseRef: 'main', existingWorktreePath: '/wt/x' }),
    ).toEqual({ kind: 'use-checkout' })
  })

  it('blocks a first worktree send without a base ref', () => {
    expect(
      resolveWorktreeSendPlan({ mode: 'worktree', baseRef: null, existingWorktreePath: null }),
    ).toEqual({ kind: 'blocked', reason: 'base-ref-required' })
    expect(
      resolveWorktreeSendPlan({ mode: 'worktree', baseRef: '   ', existingWorktreePath: null }),
    ).toEqual({ kind: 'blocked', reason: 'base-ref-required' })
  })

  it('plans worktree creation from a chosen base ref', () => {
    expect(
      resolveWorktreeSendPlan({ mode: 'worktree', baseRef: ' main ', existingWorktreePath: null }),
    ).toEqual({ kind: 'create-worktree', baseRef: 'main' })
  })
})
