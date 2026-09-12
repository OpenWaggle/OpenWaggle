import type { TerminalEventPayload } from '@shared/types/terminal'
import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { beginTerminalEventOwnerHandoff } from '../../lib/terminal-event-owner-alias'
import {
  getTerminalPaneMocks,
  OWNER,
  renderPane,
  resetTerminalPaneHarness,
  TERMINAL_ID,
} from './terminal-pane-test-harness'

const mocks = getTerminalPaneMocks()

const SNAPSHOT_OUTPUT_BYTES = 6

async function renderPaneWithSnapshot() {
  mocks.openTerminal.mockResolvedValue({
    history: '',
    outputBytes: SNAPSHOT_OUTPUT_BYTES,
    outputGeneration: 1,
    readiness: { phase: 'ready', generation: 1 },
    running: true,
  })
  renderPane()
  await waitFor(() => expect(mocks.openTerminal).toHaveBeenCalledOnce())
  await act(async () => undefined)
  const handler = mocks.getEventHandler()
  if (handler === null) throw new Error('Expected terminal event handler')
  return handler
}

function emitOutput(
  handler: (payload: TerminalEventPayload) => void,
  data: string,
  startOffset: number,
  endOffset: number,
) {
  act(() => {
    handler({
      ownerKey: OWNER,
      terminalId: TERMINAL_ID,
      event: { type: 'output', data, outputGeneration: 1, startOffset, endOffset },
    })
  })
}

describe('TerminalPane output offset gating', () => {
  beforeEach(resetTerminalPaneHarness)

  it('drops output entirely covered by the attach snapshot', async () => {
    const handler = await renderPaneWithSnapshot()
    emitOutput(handler, 'abcdef', 0, SNAPSHOT_OUTPUT_BYTES)

    expect(mocks.terminalInstances[0]?.write).not.toHaveBeenCalled()
    expect(mocks.acknowledgeTerminalOutput).toHaveBeenCalledWith(
      OWNER,
      TERMINAL_ID,
      1,
      SNAPSHOT_OUTPUT_BYTES,
    )
  })

  it('writes only the suffix beyond the attach snapshot', async () => {
    const handler = await renderPaneWithSnapshot()
    emitOutput(handler, 'abcdef', 2, 8)

    expect(mocks.terminalInstances[0]?.write).toHaveBeenCalledExactlyOnceWith(
      'ef',
      expect.any(Function),
    )
    expect(mocks.acknowledgeTerminalOutput).toHaveBeenCalledWith(OWNER, TERMINAL_ID, 1, 8)
  })

  it('writes output entirely beyond the attach snapshot', async () => {
    const handler = await renderPaneWithSnapshot()
    emitOutput(handler, 'xyz', SNAPSHOT_OUTPUT_BYTES, 9)

    expect(mocks.terminalInstances[0]?.write).toHaveBeenCalledExactlyOnceWith(
      'xyz',
      expect.any(Function),
    )
    expect(mocks.acknowledgeTerminalOutput).toHaveBeenCalledWith(OWNER, TERMINAL_ID, 1, 9)
  })

  it('acknowledges but never renders output from an old generation', async () => {
    mocks.openTerminal.mockResolvedValue({
      history: '',
      outputBytes: 0,
      outputGeneration: 2,
      readiness: { phase: 'ready', generation: 2 },
      running: true,
    })
    renderPane()
    await waitFor(() => expect(mocks.openTerminal).toHaveBeenCalledOnce())
    await act(async () => undefined)
    const handler = mocks.getEventHandler()
    if (handler === null) throw new Error('Expected terminal event handler')

    act(() => {
      handler({
        ownerKey: OWNER,
        terminalId: TERMINAL_ID,
        event: {
          type: 'output',
          data: 'stale',
          outputGeneration: 1,
          startOffset: 0,
          endOffset: 5,
        },
      })
    })

    expect(mocks.terminalInstances[0]?.write).not.toHaveBeenCalled()
    expect(mocks.acknowledgeTerminalOutput).toHaveBeenCalledWith(OWNER, TERMINAL_ID, 1, 5)
  })

  it('consumes destination-owner output while a draft handoff is committing', async () => {
    const handler = await renderPaneWithSnapshot()
    const release = beginTerminalEventOwnerHandoff(OWNER, 'session-born')

    act(() => {
      handler({
        ownerKey: 'session-born',
        terminalId: TERMINAL_ID,
        event: {
          type: 'output',
          data: 'new',
          outputGeneration: 1,
          startOffset: SNAPSHOT_OUTPUT_BYTES,
          endOffset: 9,
        },
      })
    })
    release()

    expect(mocks.terminalInstances[0]?.write).toHaveBeenCalledExactlyOnceWith(
      'new',
      expect.any(Function),
    )
    expect(mocks.acknowledgeTerminalOutput).toHaveBeenCalledWith(OWNER, TERMINAL_ID, 1, 9)
  })
})
