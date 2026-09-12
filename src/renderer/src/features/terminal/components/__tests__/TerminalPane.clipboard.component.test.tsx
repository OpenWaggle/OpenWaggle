import { act, screen, waitFor } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getTerminalPaneMocks,
  OWNER,
  renderPane,
  resetTerminalPaneHarness,
  TERMINAL_ID,
} from './terminal-pane-test-harness'

const mocks = getTerminalPaneMocks()

function keyEvent(options: Partial<KeyboardEvent>) {
  return fromPartial<KeyboardEvent>({
    type: 'keydown',
    key: '',
    code: '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    ...options,
  })
}

describe('TerminalPane native clipboard shortcuts', () => {
  beforeEach(resetTerminalPaneHarness)

  it('copies a selection without stealing Ctrl+C when no selection exists', async () => {
    renderPane()
    await waitFor(() => expect(mocks.openTerminal).toHaveBeenCalledOnce())
    const preventCopy = vi.fn()
    act(() => mocks.setSelection('selected output'))

    const copied = mocks.emitKey(keyEvent({ key: 'c', ctrlKey: true, preventDefault: preventCopy }))

    expect(copied).toBe(false)
    expect(preventCopy).toHaveBeenCalledOnce()
    expect(mocks.copyToClipboard).toHaveBeenCalledWith('selected output')
    expect(mocks.terminalInstances[0]?.clearSelection).toHaveBeenCalledOnce()
    mocks.copyToClipboard.mockClear()
    mocks.terminalInstances[0]?.clearSelection.mockClear()

    const copiedAndPreserved = mocks.emitKey(keyEvent({ key: 'c', ctrlKey: true, shiftKey: true }))
    expect(copiedAndPreserved).toBe(false)
    expect(mocks.copyToClipboard).toHaveBeenCalledWith('selected output')
    expect(mocks.terminalInstances[0]?.clearSelection).not.toHaveBeenCalled()
    mocks.copyToClipboard.mockClear()
    act(() => mocks.setSelection(''))

    expect(mocks.emitKey(keyEvent({ key: 'c', ctrlKey: true }))).toBe(true)
    expect(mocks.copyToClipboard).not.toHaveBeenCalled()
  })

  it('shows clipboard write failures without offering the readiness release action', async () => {
    mocks.copyToClipboard.mockImplementationOnce(() => {
      throw new Error('clipboard denied')
    })
    renderPane()
    await waitFor(() => expect(mocks.openTerminal).toHaveBeenCalledOnce())
    act(() => mocks.setSelection('selected output'))

    act(() => {
      mocks.emitKey(keyEvent({ key: 'c', ctrlKey: true }))
    })

    expect(
      await screen.findByText('Clipboard could not be written. Check system access and retry.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send now' })).not.toBeInTheDocument()
    expect(mocks.terminalInstances[0]?.clearSelection).not.toHaveBeenCalled()
  })

  it('pastes host clipboard text with Ctrl+Shift+V', async () => {
    renderPane()
    await waitFor(() => expect(mocks.openTerminal).toHaveBeenCalledOnce())
    const preventDefault = vi.fn()

    const handled = mocks.emitKey(
      keyEvent({ key: 'v', ctrlKey: true, shiftKey: true, preventDefault }),
    )

    expect(handled).toBe(false)
    expect(preventDefault).toHaveBeenCalledOnce()
    await waitFor(() =>
      expect(mocks.writeTerminal).toHaveBeenCalledWith(
        OWNER,
        TERMINAL_ID,
        'clipboard text',
        expect.objectContaining({ generation: expect.any(String), sequence: 0 }),
      ),
    )
  })

  it('suppresses the keyup only when OpenWaggle handled the matching keydown', async () => {
    renderPane()
    await waitFor(() => expect(mocks.openTerminal).toHaveBeenCalledOnce())
    act(() => mocks.setSelection('selected output'))

    expect(mocks.emitKey(keyEvent({ key: 'c', code: 'KeyC', ctrlKey: true }))).toBe(false)
    expect(mocks.emitKey(keyEvent({ type: 'keyup', key: 'c', code: 'KeyC', ctrlKey: true }))).toBe(
      false,
    )

    act(() => mocks.setSelection(''))
    expect(mocks.emitKey(keyEvent({ key: 'c', code: 'KeyC', ctrlKey: true }))).toBe(true)
    expect(mocks.emitKey(keyEvent({ type: 'keyup', key: 'c', code: 'KeyC', ctrlKey: true }))).toBe(
      true,
    )
  })

  it('suppresses a native editing release even after its modifiers lift', async () => {
    renderPane()
    await waitFor(() => expect(mocks.openTerminal).toHaveBeenCalledOnce())

    expect(mocks.emitKey(keyEvent({ key: 'l', code: 'KeyL', ctrlKey: true }))).toBe(false)
    expect(mocks.emitKey(keyEvent({ type: 'keyup', key: 'l', code: 'KeyL' }))).toBe(false)
    expect(mocks.emitKey(keyEvent({ type: 'keyup', key: 'k', code: 'KeyK' }))).toBe(true)
  })

  it('finishes an ordered clipboard paste after the same runtime remounts', async () => {
    const clipboard = Promise.withResolvers<string>()
    mocks.readFromClipboard.mockReturnValueOnce(clipboard.promise)
    const firstView = renderPane()
    await waitFor(() => expect(mocks.openTerminal).toHaveBeenCalledOnce())
    await act(async () => undefined)
    const inputGeneration = mocks.openTerminal.mock.calls[0]?.[0].inputGeneration

    act(() => {
      mocks.emitKey(keyEvent({ key: 'v', ctrlKey: true, shiftKey: true }))
    })
    await waitFor(() => expect(mocks.readFromClipboard).toHaveBeenCalledOnce())
    firstView.unmount()

    renderPane()
    await waitFor(() => expect(mocks.openTerminal).toHaveBeenCalledTimes(2))
    expect(mocks.openTerminal.mock.calls[1]?.[0].inputGeneration).toBe(inputGeneration)
    clipboard.resolve('paste after remount')

    await waitFor(() =>
      expect(mocks.writeTerminal).toHaveBeenCalledWith(
        OWNER,
        TERMINAL_ID,
        'paste after remount',
        expect.objectContaining({ generation: inputGeneration, sequence: 0 }),
      ),
    )
  })
})
