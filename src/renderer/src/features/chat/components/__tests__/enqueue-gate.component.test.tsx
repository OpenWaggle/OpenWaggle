import type { AgentSendPayload } from '@shared/types/agent'
import { SessionId } from '@shared/types/brand'
import { describe, expect, it, vi } from 'vitest'
import { enqueueIfAllowed } from '../ChatComposerStack'

const PAYLOAD: AgentSendPayload = { text: 'do the thing', thinkingLevel: 'off', attachments: [] }

describe('enqueueIfAllowed', () => {
  it('refuses to queue a message the send gate would block, and says why', () => {
    /*
     * A queued message is dispatched later with the raw send, so queueing walked straight past the
     * worktree gate: main rejected it with a bare thrown error and the message was silently
     * re-enqueued instead of the user seeing the recover-or-switch notice.
     */
    const enqueue = vi.fn()
    const onToast = vi.fn()

    enqueueIfAllowed({
      payload: PAYLOAD,
      activeSessionId: SessionId('session-a'),
      sendBlockedReason: "This session's worktree no longer exists.",
      enqueue,
      onToast,
    })

    expect(enqueue).not.toHaveBeenCalled()
    expect(onToast).toHaveBeenCalledWith("This session's worktree no longer exists.")
  })

  it('queues against the active session when nothing blocks the send', () => {
    const enqueue = vi.fn()

    enqueueIfAllowed({
      payload: PAYLOAD,
      activeSessionId: SessionId('session-a'),
      sendBlockedReason: null,
      enqueue,
      onToast: vi.fn(),
    })

    expect(enqueue).toHaveBeenCalledWith(SessionId('session-a'), PAYLOAD)
  })

  it('does nothing without an active session', () => {
    const enqueue = vi.fn()

    enqueueIfAllowed({
      payload: PAYLOAD,
      activeSessionId: null,
      sendBlockedReason: null,
      enqueue,
      onToast: vi.fn(),
    })

    expect(enqueue).not.toHaveBeenCalled()
  })
})
