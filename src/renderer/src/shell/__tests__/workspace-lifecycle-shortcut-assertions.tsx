import { act, renderHook } from '@testing-library/react'
import { expect, type Mock, vi } from 'vitest'
import { useUIStore } from '../ui-store'
import { useWorkspaceLifecycle } from '../useWorkspaceLifecycle'

export function runHotkey(hotkey: string, target?: Element) {
  const parts = hotkey.split('+')
  const key = parts.at(-1) ?? ''
  const event = new KeyboardEvent('keydown', {
    key: key.toLowerCase(),
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    ctrlKey: parts.includes('Mod'),
    altKey: parts.includes('Alt'),
    shiftKey: parts.includes('Shift'),
    cancelable: true,
    bubbles: true,
  })
  ;(target ?? window).dispatchEvent(event)
}

export function expectTerminalInputOwnsApplicationShortcuts(
  startDraftSession: Mock,
  toggleDiff: Mock,
) {
  renderHook(() => useWorkspaceLifecycle())
  const pane = document.createElement('div')
  pane.dataset.terminalPane = 'term-1'
  const textarea = document.createElement('textarea')
  pane.append(textarea)

  act(() => runHotkey('Mod+N', textarea))
  act(() => runHotkey('Mod+D', textarea))

  expect(startDraftSession).not.toHaveBeenCalled()
  expect(toggleDiff).not.toHaveBeenCalled()
}

export function expectGlobalChordsBeforeXterm() {
  renderHook(() => useWorkspaceLifecycle())
  const pane = document.createElement('div')
  pane.dataset.terminalPane = 'term-1'
  const textarea = document.createElement('textarea')
  pane.append(textarea)
  document.body.append(pane)
  const terminalKeyDown = vi.fn()
  const terminalKeyUp = vi.fn()
  textarea.addEventListener('keydown', terminalKeyDown)
  textarea.addEventListener('keyup', terminalKeyUp)

  const press = new KeyboardEvent('keydown', {
    key: 'b',
    code: 'KeyB',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  })
  act(() => textarea.dispatchEvent(press))

  expect(useUIStore.getState().sidebarOpen).toBe(false)
  expect(press.defaultPrevented).toBe(true)
  expect(terminalKeyDown).not.toHaveBeenCalled()

  // The physical shortcut key may be released after its modifier.
  const release = new KeyboardEvent('keyup', {
    key: 'b',
    code: 'KeyB',
    bubbles: true,
    cancelable: true,
  })
  act(() => textarea.dispatchEvent(release))
  expect(release.defaultPrevented).toBe(true)
  expect(terminalKeyUp).not.toHaveBeenCalled()

  const laterRelease = new KeyboardEvent('keyup', {
    key: 'b',
    code: 'KeyB',
    bubbles: true,
    cancelable: true,
  })
  act(() => textarea.dispatchEvent(laterRelease))
  expect(laterRelease.defaultPrevented).toBe(false)
  expect(terminalKeyUp).toHaveBeenCalledOnce()
  pane.remove()
}
