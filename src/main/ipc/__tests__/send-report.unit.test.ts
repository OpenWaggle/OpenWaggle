import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'

// agent-handler reaches Electron transitively; only the reporting rule is under test.
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getName: () => 'openwaggle-test' },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}))

const { describeSendOutcomeForTests } = await import('../agent-handler')

/**
 * A caller with work to protect - a submitted review - decides whether to keep it from this report, so an
 * outcome that claims delivery it cannot prove loses the user's work.
 */
describe('send outcome reporting', () => {
  it('reports delivery only for a run that produced a turn', () => {
    expect(
      describeSendOutcomeForTests({
        outcome: 'success',
        newMessages: [],
        resourceMessages: [],
        resourceNodeIds: {},
        resourceBranchIds: {},
      }),
    ).toEqual({
      outcome: 'delivered',
    })
  })

  it('reports a cancellation as its own outcome, not as a refusal', () => {
    /*
     * A run cancelled before its prompt was sent reports the same thing as one cancelled mid-turn, so it is
     * evidence in neither direction. Reporting it as a refusal made the ordinary Stop flow raise an error:
     * stopping settles the run and a queued follow-up send begins immediately, so the superseded send's reply
     * arrives after the replacement has started.
     */
    expect(describeSendOutcomeForTests({ outcome: 'aborted' })).toEqual({ outcome: 'cancelled' })
  })

  it('passes the reason through for a failed run', () => {
    expect(
      describeSendOutcomeForTests({
        outcome: 'error',
        message: 'This session has no worktree.',
        code: 'worktree-missing',
      }),
    ).toEqual({
      outcome: 'refused',
      message: 'This session has no worktree.',
      code: 'worktree-missing',
    })
  })

  it('reports delivery for a run that failed after the turn began', () => {
    /*
     * A provider error or a rate limit mid-turn is a failure *after* the message arrived, and main marks that
     * with `transportEmitted`. Reporting it as a refusal made a caller restore a review the agent already held
     * and offer it for a second submission - and it drove the renderer to guess at delivery from stream events,
     * which cannot tell one send in a session from the next.
     */
    expect(
      describeSendOutcomeForTests({
        outcome: 'error',
        message: 'Rate limit reached.',
        code: 'rate-limit',
        transportEmitted: true,
      }),
    ).toEqual({ outcome: 'delivered' })
  })
})
