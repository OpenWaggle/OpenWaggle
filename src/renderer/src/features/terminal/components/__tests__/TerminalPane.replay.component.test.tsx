import type { TerminalAttachResult } from '@shared/types/terminal'
import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  getTerminalPaneMocks,
  OWNER,
  renderPane,
  resetTerminalPaneHarness,
  TERMINAL_ID,
} from './terminal-pane-test-harness'

const mocks = getTerminalPaneMocks()

const PALETTE_QUERY = '\x1b]4;0;?\x1b\\'
const STATUS_REPORT = '\x1b[0n'

function writtenToPty() {
  return mocks.writeTerminal.mock.calls.map(([, , data]) => data)
}

describe('TerminalPane attach replay', () => {
  beforeEach(resetTerminalPaneHarness)

  it('keeps reports xterm generates while replaying history away from the PTY', async () => {
    const open = Promise.withResolvers<TerminalAttachResult>()
    mocks.openTerminal.mockReturnValue(open.promise)
    renderPane()
    await waitFor(() => expect(mocks.openTerminal).toHaveBeenCalledOnce())
    const term = mocks.terminalInstances[0]
    if (term === undefined) throw new Error('Expected an xterm instance')
    const parsedCallbacks: (() => void)[] = []
    term.write.mockImplementation((_data: string, callback?: () => void) => {
      if (callback !== undefined) parsedCallbacks.push(callback)
    })

    await act(async () =>
      open.resolve({
        inputIncarnation: 'native-record-1',
        history: `pi${PALETTE_QUERY}\r\n$ `,
        outputBytes: 16,
        outputGeneration: 1,
        readiness: { phase: 'ready', generation: 1 },
        running: true,
        processName: null,
        ports: [],
        projectActionPending: false,
      }),
    )

    expect(term.write.mock.calls.map(([data]) => data).join('')).toBe('pi\r\n$ ')
    act(() => mocks.emitInput(STATUS_REPORT))
    act(() => mocks.emitInput('ls'))
    await waitFor(() => expect(writtenToPty()).toContain('ls'))
    expect(writtenToPty()).not.toContain(STATUS_REPORT)

    act(() => {
      for (const parsed of parsedCallbacks.splice(0)) parsed()
    })
    act(() => mocks.emitInput(STATUS_REPORT))
    await waitFor(() => expect(writtenToPty()).toContain(STATUS_REPORT))
    expect(mocks.writeTerminal).toHaveBeenCalledWith(
      OWNER,
      TERMINAL_ID,
      STATUS_REPORT,
      expect.anything(),
    )
  })
})
