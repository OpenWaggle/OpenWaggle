import { TERMINAL } from '@shared/constants/resource-limits'
import type { TerminalAttachResult, TerminalInputIdentity } from '@shared/types/terminal'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  getTerminalPaneMocks,
  OWNER,
  renderPane,
  resetTerminalPaneHarness,
  TERMINAL_ID,
} from './terminal-pane-test-harness'

const mocks = getTerminalPaneMocks()

describe('TerminalPane exact input delivery', () => {
  beforeEach(resetTerminalPaneHarness)

  it('stages input in main while the asynchronous open is unresolved', async () => {
    const open = Promise.withResolvers<TerminalAttachResult>()
    mocks.openTerminal.mockReturnValue(open.promise)
    mocks.writeTerminal.mockImplementation(
      async (_owner, _terminalId, data: string, identity: TerminalInputIdentity) => ({
        status: 'queued' as const,
        acceptedBytes: new TextEncoder().encode(data).byteLength,
        identity,
      }),
    )

    renderPane()
    await waitFor(() => expect(mocks.openTerminal).toHaveBeenCalledOnce())
    act(() => mocks.emitInput('typed-before-open'))
    await waitFor(() =>
      expect(mocks.writeTerminal).toHaveBeenCalledWith(
        OWNER,
        TERMINAL_ID,
        'typed-before-open',
        expect.objectContaining({ generation: expect.any(String), sequence: 0 }),
      ),
    )

    open.resolve({
      history: '',
      outputBytes: 0,
      outputGeneration: 1,
      readiness: { phase: 'awaiting-prompt', generation: 1 },
      pendingInputBytes: 17,
      running: true,
      processName: null,
      ports: [],
      projectActionPending: false,
    })

    expect(await screen.findByRole('button', { name: 'Send now' })).toBeInTheDocument()
  })

  it('does not resend main-acknowledged input after an open failure and remount', async () => {
    const open = Promise.withResolvers<TerminalAttachResult>()
    mocks.openTerminal.mockReturnValueOnce(open.promise)
    mocks.writeTerminal.mockImplementation(
      async (_owner, _terminalId, data: string, identity: TerminalInputIdentity) => ({
        status: 'queued' as const,
        acceptedBytes: new TextEncoder().encode(data).byteLength,
        identity,
      }),
    )
    const failedView = renderPane()
    await waitFor(() => expect(mocks.openTerminal).toHaveBeenCalledOnce())
    const inputGeneration = mocks.openTerminal.mock.calls[0]?.[0].inputGeneration
    act(() => mocks.emitInput('retained-after-attach-error'))
    await waitFor(() => expect(mocks.writeTerminal).toHaveBeenCalledOnce())

    await act(async () => open.reject(new Error('temporary attach failure')))
    expect(await screen.findByText('temporary attach failure')).toBeInTheDocument()
    failedView.unmount()

    renderPane()
    await waitFor(() => expect(mocks.openTerminal).toHaveBeenCalledTimes(2))
    expect(mocks.openTerminal.mock.calls[1]?.[0].inputGeneration).not.toBe(inputGeneration)
    expect(mocks.writeTerminal).toHaveBeenCalledOnce()
  })

  it('chunks a large paste without changing its bytes or order', async () => {
    renderPane()
    await waitFor(() => expect(mocks.openTerminal).toHaveBeenCalledOnce())
    await act(async () => undefined)
    const paste = 'x'.repeat(TERMINAL.MAX_INPUT_BYTES * 3 + 17)

    act(() => mocks.emitInput(paste))

    await waitFor(() => expect(mocks.writeTerminal).toHaveBeenCalledTimes(4))
    const chunks = mocks.writeTerminal.mock.calls.flatMap((call) =>
      typeof call[2] === 'string' ? [call[2]] : [],
    )
    expect(chunks.join('')).toBe(paste)
    expect(chunks.every((chunk) => chunk.length <= TERMINAL.MAX_INPUT_BYTES)).toBe(true)
  })

  it('shows queued startup input and lets the user release it explicitly', async () => {
    mocks.openTerminal.mockResolvedValue({
      history: '',
      outputBytes: 0,
      outputGeneration: 1,
      readiness: { phase: 'awaiting-prompt', generation: 1 },
      running: true,
    })
    mocks.writeTerminal.mockImplementation(
      async (_owner, _terminalId, data: string, identity: TerminalInputIdentity) => ({
        status: 'queued' as const,
        acceptedBytes: new TextEncoder().encode(data).byteLength,
        identity,
      }),
    )

    renderPane()
    await waitFor(() => expect(mocks.openTerminal).toHaveBeenCalledOnce())
    act(() => mocks.emitInput('abc'))

    fireEvent.click(await screen.findByRole('button', { name: 'Send now' }))
    await waitFor(() => expect(mocks.sendTerminalInputNow).toHaveBeenCalledWith(OWNER, TERMINAL_ID))
  })

  it('keeps mounted input usable after a backend close and restart', async () => {
    renderPane()
    await waitFor(() => expect(mocks.openTerminal).toHaveBeenCalledOnce())
    const handler = mocks.getEventHandler()
    if (handler === null) throw new Error('Expected terminal event handler')

    act(() => {
      handler({ ownerKey: OWNER, terminalId: TERMINAL_ID, event: { type: 'closed' } })
    })
    expect(await screen.findByText('Shell stopped')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    await waitFor(() => expect(mocks.restartTerminal).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.queryByText('Shell stopped')).not.toBeInTheDocument())

    act(() => mocks.emitInput('works after restart'))
    await waitFor(() =>
      expect(mocks.writeTerminal).toHaveBeenCalledWith(
        OWNER,
        TERMINAL_ID,
        'works after restart',
        expect.objectContaining({ generation: expect.any(String), sequence: 0 }),
      ),
    )
  })
})
