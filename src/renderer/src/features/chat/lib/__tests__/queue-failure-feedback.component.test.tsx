import type { AgentSendPayload } from '@shared/types/agent'
import { SessionId } from '@shared/types/brand'
import { describe, expect, it, vi } from 'vitest'
import { WORKTREE_MISSING_REASON } from '@/features/git'
import { reportAutoSendQueueFailure } from '../queue-failure-feedback'

const PAYLOAD: AgentSendPayload = { text: 'queued work', thinkingLevel: 'off', attachments: [] }

function deps() {
  return {
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    showToast: vi.fn(),
  }
}

describe('reportAutoSendQueueFailure', () => {
  it('surfaces the recover-or-switch message when the session worktree is gone', () => {
    /*
     * A queued message is dispatched long after it was written, so it can reach a tree that has since
     * disappeared - and main refuses outright. Reporting the generic queue message there hid the one
     * piece of information the user could act on, while the composer offers both recoveries.
     */
    const d = deps()

    reportAutoSendQueueFailure(
      d,
      SessionId('session-a'),
      PAYLOAD,
      new Error(WORKTREE_MISSING_REASON),
    )

    expect(d.showToast).toHaveBeenCalledWith(WORKTREE_MISSING_REASON)
  })

  it('keeps the generic message for an ordinary send failure', () => {
    const d = deps()

    reportAutoSendQueueFailure(d, SessionId('session-a'), PAYLOAD, new Error('network died'))

    expect(d.showToast).toHaveBeenCalledWith(
      'Queued message failed to send automatically. It stayed in the queue.',
    )
  })
})
