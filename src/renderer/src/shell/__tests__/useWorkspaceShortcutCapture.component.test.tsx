import { DEFAULT_SHORTCUT_BINDINGS } from '@shared/types/shortcuts'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useWorkspaceShortcutCapture } from '../useWorkspaceShortcutCapture'

function renderShortcutCapture() {
  return renderHook(() =>
    useWorkspaceShortcutCapture({
      shortcutBindings: DEFAULT_SHORTCUT_BINDINGS,
      toggleSidebar: vi.fn(),
      toggleTerminal: vi.fn(),
    }),
  )
}

function terminalTarget() {
  const pane = document.createElement('div')
  pane.dataset.terminalPane = 'term-1'
  const textarea = document.createElement('textarea')
  pane.append(textarea)
  document.body.append(pane)
  return { pane, textarea }
}

function closeKeyDown(repeat = false) {
  return new KeyboardEvent('keydown', {
    key: 'w',
    code: 'KeyW',
    ctrlKey: true,
    repeat,
    bubbles: true,
    cancelable: true,
  })
}

describe('useWorkspaceShortcutCapture terminal close guard', () => {
  it('holds the close chord after its final terminal target unmounts', () => {
    renderShortcutCapture()
    const { pane, textarea } = terminalTarget()
    const initialPress = closeKeyDown()
    act(() => textarea.dispatchEvent(initialPress))
    expect(initialPress.defaultPrevented).toBe(false)

    pane.remove()
    const repeatAfterUnmount = closeKeyDown(true)
    act(() => window.dispatchEvent(repeatAfterUnmount))
    expect(repeatAfterUnmount.defaultPrevented).toBe(true)

    const releaseAfterUnmount = new KeyboardEvent('keyup', {
      key: 'w',
      code: 'KeyW',
      bubbles: true,
      cancelable: true,
    })
    act(() => window.dispatchEvent(releaseAfterUnmount))
    expect(releaseAfterUnmount.defaultPrevented).toBe(true)

    const laterRepeat = closeKeyDown(true)
    act(() => window.dispatchEvent(laterRepeat))
    expect(laterRepeat.defaultPrevented).toBe(false)
  })

  it('forgets the held close chord when the window blurs', () => {
    renderShortcutCapture()
    const { pane, textarea } = terminalTarget()
    act(() => {
      textarea.dispatchEvent(closeKeyDown())
      window.dispatchEvent(new Event('blur'))
    })
    pane.remove()

    const repeatAfterBlur = closeKeyDown(true)
    act(() => window.dispatchEvent(repeatAfterBlur))
    expect(repeatAfterBlur.defaultPrevented).toBe(false)
  })
})
