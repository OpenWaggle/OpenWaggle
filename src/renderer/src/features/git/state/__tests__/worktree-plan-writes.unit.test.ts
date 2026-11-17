import { SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { draftWorktreePlanKey, PROJECTLESS_DRAFT_WORKTREE_PLAN_KEY } from '../worktree-plan-store'
import {
  pendingWorktreePlanWrite,
  trackWorktreePlanWrite,
  worktreePlanKey,
} from '../worktree-plan-writes'

/**
 * The registry is what keeps a send from overtaking the base-ref pick it follows, so these
 * cases assert its real bookkeeping rather than a component's mock of it: a wrong key, a
 * missing wait, or a newer write forgotten too early all restore the reported bug (the pick
 * looked ignored because birth read the previous ref).
 */
describe('worktree plan writes', () => {
  it('keys a plan by Session, then draft project, then the projectless draft', () => {
    expect(
      worktreePlanKey({
        sessionId: SessionId('session-a'),
        projectPath: '/repo',
        isFirstMessage: false,
      }),
    ).toBe('session-a')
    expect(worktreePlanKey({ sessionId: null, projectPath: '/repo', isFirstMessage: true })).toBe(
      draftWorktreePlanKey('/repo'),
    )
    expect(worktreePlanKey({ sessionId: null, projectPath: null, isFirstMessage: true })).toBe(
      PROJECTLESS_DRAFT_WORKTREE_PLAN_KEY,
    )
    expect(worktreePlanKey({ sessionId: null, projectPath: null, isFirstMessage: false })).toBe('')
  })

  it('hands a send the pending write, which resolves once it settles', async () => {
    const key = 'session-waits'
    let release = () => {}
    trackWorktreePlanWrite(
      key,
      new Promise<void>((resolve) => {
        release = resolve
      }),
    )

    let waited = false
    const pending = pendingWorktreePlanWrite(key)
    if (!pending) throw new Error('A tracked write must be pending.')
    const waiting = pending.then(() => {
      waited = true
    })
    await Promise.resolve()
    expect(waited).toBe(false)

    release()
    await waiting
    expect(waited).toBe(true)
  })

  it('waits for the newest write when a pick is replaced before it lands', async () => {
    const key = 'session-replaced'
    let releaseFirst = () => {}
    let releaseLast = () => {}
    trackWorktreePlanWrite(key, new Promise<void>((resolve) => (releaseFirst = resolve)))
    trackWorktreePlanWrite(key, new Promise<void>((resolve) => (releaseLast = resolve)))

    let waited = false
    const pending = pendingWorktreePlanWrite(key)
    if (!pending) throw new Error('A tracked write must be pending.')
    const waiting = pending.then(() => {
      waited = true
    })

    releaseFirst()
    await Promise.resolve()
    expect(waited).toBe(false)

    releaseLast()
    await waiting
    expect(waited).toBe(true)
  })

  it('hands back a settled wait when the write fails', async () => {
    const key = 'session-failed'
    trackWorktreePlanWrite(key, Promise.reject(new Error('Session handoff was rejected')))

    await expect(pendingWorktreePlanWrite(key)).resolves.toBeUndefined()
  })

  it('has nothing pending for an untouched or an empty key', () => {
    expect(pendingWorktreePlanWrite('session-untouched')).toBeUndefined()
    trackWorktreePlanWrite('', Promise.resolve())
    expect(pendingWorktreePlanWrite('')).toBeUndefined()
  })
})
