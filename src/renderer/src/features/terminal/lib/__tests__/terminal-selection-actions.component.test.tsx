import { fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  observeTerminalSelectionActions,
  TERMINAL_SELECTION_MULTI_CLICK_MS,
} from '../terminal-selection-actions'

describe('terminal selection action observer', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('waits for a multiclick gesture to settle before anchoring at its release point', () => {
    vi.useFakeTimers()
    const terminal = document.createElement('div')
    document.body.append(terminal)
    const onSelection = vi.fn()
    const observer = observeTerminalSelectionActions({
      element: terminal,
      getActionElement: () => null,
      onSelection,
      onDismiss: vi.fn(),
    })

    fireEvent.pointerDown(terminal, { button: 0, isPrimary: true })
    fireEvent.mouseUp(window, { button: 0, detail: 2, clientX: 210, clientY: 140 })
    vi.advanceTimersByTime(TERMINAL_SELECTION_MULTI_CLICK_MS - 1)
    expect(onSelection).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(onSelection).toHaveBeenCalledExactlyOnceWith({ x: 210, y: 140 })
    observer.dispose()
  })

  it('does not open actions when the terminal claims the pointer for application mouse input', () => {
    vi.useFakeTimers()
    const terminal = document.createElement('div')
    terminal.addEventListener('pointerdown', (event) => event.preventDefault())
    document.body.append(terminal)
    const onSelection = vi.fn()
    const observer = observeTerminalSelectionActions({
      element: terminal,
      getActionElement: () => null,
      onSelection,
      onDismiss: vi.fn(),
    })

    fireEvent.pointerDown(terminal, { button: 0, isPrimary: true })
    fireEvent.mouseUp(window, { button: 0, detail: 1, clientX: 210, clientY: 140 })
    vi.runAllTimers()

    expect(onSelection).not.toHaveBeenCalled()
    observer.dispose()
  })

  it.each(['scroll', 'blur', 'resize'] as const)('dismisses on %s', (eventName) => {
    const terminal = document.createElement('div')
    document.body.append(terminal)
    const onDismiss = vi.fn()
    const observer = observeTerminalSelectionActions({
      element: terminal,
      getActionElement: () => null,
      onSelection: vi.fn(),
      onDismiss,
    })

    if (eventName === 'scroll') fireEvent.scroll(terminal)
    else fireEvent(window, new Event(eventName))
    expect(onDismiss).toHaveBeenCalledOnce()
    observer.dispose()
  })

  it('dismisses on Escape or focus leaving the terminal action surface', () => {
    const terminal = document.createElement('div')
    const toolbar = document.createElement('div')
    const outside = document.createElement('button')
    document.body.append(terminal, toolbar, outside)
    const onDismiss = vi.fn()
    const observer = observeTerminalSelectionActions({
      element: terminal,
      getActionElement: () => toolbar,
      onSelection: vi.fn(),
      onDismiss,
    })

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledOnce()
    outside.focus()
    expect(onDismiss).toHaveBeenCalledTimes(2)
    observer.dispose()
  })
})
