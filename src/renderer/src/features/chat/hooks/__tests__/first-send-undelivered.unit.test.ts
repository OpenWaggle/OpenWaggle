import { SessionId } from '@shared/types/brand'
import { describe, expect, it, vi } from 'vitest'
import { MessageNotDelivered } from '../../lib/message-delivery'
import { useBackgroundRunStore } from '../../state/background-run-store'
import { forgetRefusedFirstMessage } from '../first-send-undelivered'

const SESSION_ID = SessionId('session-empty')

/*
 * An existing empty Session's refused first message goes back to the composer, so its worktree
 * launch row must not offer to send it too: the message would go twice.
 */
describe('forgetRefusedFirstMessage', () => {
  it('clears the first-send recovery and the launch row of a refused first message', () => {
    useBackgroundRunStore.getState().setWorktreeLaunch(SESSION_ID, {
      status: 'failed',
      stage: 'preparing-workspace',
      startedAt: 1,
      updatedAt: 2,
      details: ['git worktree add failed'],
    })
    const setFirstSendRecovery = vi.fn()

    const forgot = forgetRefusedFirstMessage(
      new MessageNotDelivered('refused', 'git worktree add failed'),
      SESSION_ID,
      setFirstSendRecovery,
    )

    expect(forgot).toBe(true)
    expect(setFirstSendRecovery).toHaveBeenCalledWith(SESSION_ID, null)
    expect(useBackgroundRunStore.getState().getWorktreeLaunch(SESSION_ID)).toBeNull()
  })

  it('leaves a failure that was not a refusal alone', () => {
    const setFirstSendRecovery = vi.fn()

    expect(forgetRefusedFirstMessage(new Error('boom'), SESSION_ID, setFirstSendRecovery)).toBe(
      false,
    )
    expect(setFirstSendRecovery).not.toHaveBeenCalled()
  })
})
