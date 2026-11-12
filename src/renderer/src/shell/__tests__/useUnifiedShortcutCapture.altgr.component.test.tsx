import type { BrowserPreviewKeyEvent } from '@shared/types/browser-preview'
import type { ShortcutBinding } from '@shared/types/shortcuts'
import { DEFAULT_SHORTCUT_RULES } from '@shared/types/shortcuts'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type BuiltInShortcutHandlers,
  useUnifiedShortcutCapture,
} from '../useUnifiedShortcutCapture'

const ipcMocks = vi.hoisted(() => {
  const listeners = new Set<(event: BrowserPreviewKeyEvent) => void>()
  return {
    listeners,
    setBindings: vi.fn(async (_bindings: readonly ShortcutBinding[]) => {}),
    subscribe: vi.fn((listener: (event: BrowserPreviewKeyEvent) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    emit(event: BrowserPreviewKeyEvent) {
      for (const listener of listeners) listener(event)
    },
  }
})

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    setBrowserPreviewShortcutBindings: ipcMocks.setBindings,
    onBrowserPreviewKeyEvent: ipcMocks.subscribe,
  },
}))

function handlers(): BuiltInShortcutHandlers {
  return {
    'commandPalette.toggle': vi.fn(),
    'filePicker.toggle': vi.fn(),
    'chat.new': vi.fn(),
    'terminal.toggle': vi.fn(),
    'terminal.new': vi.fn(),
    'terminal.split': vi.fn(),
    'terminal.splitVertical': vi.fn(),
    'terminal.close': vi.fn(),
    'rightPanel.toggle': vi.fn(),
    'rightPanel.toggleMaximized': vi.fn(),
    'rightPanel.close': vi.fn(),
    'sidebar.toggle': vi.fn(),
    'diff.toggle': vi.fn(),
    'preview.toggle': vi.fn(),
    'preview.refresh': vi.fn(),
    'preview.focusUrl': vi.fn(),
    'preview.zoomIn': vi.fn(),
    'preview.zoomOut': vi.fn(),
    'preview.resetZoom': vi.fn(),
    'sessionTree.toggle': vi.fn(),
    'request.focus': vi.fn(),
    'session.copyLink': vi.fn(),
    'rightPanel.allPanels': vi.fn(),
    'rightPanel.projectActions': vi.fn(),
    'rightPanel.files': vi.fn(),
    'rightPanel.resources': vi.fn(),
    'rightPanel.hive': vi.fn(),
    'rightPanel.scheduledTasks': vi.fn(),
  }
}

describe('useUnifiedShortcutCapture with AltGr', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcMocks.listeners.clear()
  })

  function render() {
    const commandHandlers = handlers()
    renderHook(() =>
      useUnifiedShortcutCapture({
        actions: [],
        builtInRules: DEFAULT_SHORTCUT_RULES,
        handlers: commandHandlers,
        onRunProjectAction: vi.fn(),
        terminalOpen: false,
      }),
    )
    return commandHandlers
  }

  function chord(key: string, altGraph: boolean) {
    const event = new KeyboardEvent('keydown', {
      key,
      code: 'KeyL',
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
    // Chromium reports AltGr as Ctrl+Alt with the AltGraph modifier state.
    Object.defineProperty(event, 'getModifierState', {
      value: (modifier: string) => altGraph && modifier === 'AltGraph',
    })
    return event
  }

  function pressIn(target: Element, event: KeyboardEvent) {
    act(() => {
      target.dispatchEvent(event)
    })
    return event
  }

  it('leaves a character typed with AltGr to the field or terminal it is typed into', () => {
    const commandHandlers = render()
    const field = document.body.appendChild(document.createElement('textarea'))
    const pane = document.body.appendChild(document.createElement('div'))
    pane.dataset.terminalPane = 'term-1'
    const terminalInput = pane.appendChild(document.createElement('textarea'))

    // AltGr+L types "ł" on a Polish keyboard.
    expect(pressIn(field, chord('ł', true)).defaultPrevented).toBe(false)
    expect(pressIn(terminalInput, chord('ł', true)).defaultPrevented).toBe(false)
    expect(commandHandlers['session.copyLink']).not.toHaveBeenCalled()

    // Layouts that report AltGr for Ctrl+Alt still get the shortcut when no character results.
    expect(pressIn(field, chord('l', true)).defaultPrevented).toBe(true)
    expect(commandHandlers['session.copyLink']).toHaveBeenCalledOnce()
    field.remove()
    pane.remove()
  })

  it('still runs the shortcut where nothing would be typed', () => {
    const commandHandlers = render()

    expect(pressIn(document.body, chord('ł', true)).defaultPrevented).toBe(true)
    expect(commandHandlers['session.copyLink']).toHaveBeenCalledOnce()
  })
})
