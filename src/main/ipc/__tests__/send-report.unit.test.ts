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
    expect(describeSendOutcomeForTests({ outcome: 'success', newMessages: [] })).toEqual({
      delivered: true,
    })
  })

  it('claims nothing for an aborted run', () => {
    /*
     * A run cancelled before its prompt was sent reports exactly this outcome, as does any run that produced
     * no messages, so it is not evidence either way - and the caller must assume the message never arrived,
     * which is the side that keeps it.
     */
    expect(describeSendOutcomeForTests({ outcome: 'aborted' })).toEqual({ delivered: false })
  })

  it('passes the reason through for a failed run', () => {
    expect(
      describeSendOutcomeForTests({
        outcome: 'error',
        message: 'This session has no worktree.',
        code: 'worktree-missing',
      }),
    ).toEqual({
      delivered: false,
      message: 'This session has no worktree.',
      code: 'worktree-missing',
    })
  })
})
