import type { BrowserPreviewKeyEvent } from '@shared/types/browser-preview'
import type { ShortcutBinding } from '@shared/types/shortcuts'
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

vi.mock('@/shared/lib/keyboard-layout', () => ({
  trackKeyboardLayout: vi.fn(),
  noteKeyboardLayoutKeyPress: vi.fn(),
  // AZERTY: the unshifted Digit1 key types "&".
  keyboardLayoutKey: (code: string) => (code === 'Digit1' ? '&' : null),
}))

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
  }
}

describe('useUnifiedShortcutCapture with a keyboard layout map', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcMocks.listeners.clear()
  })

  it("keeps a Ctrl+Alt shortcut on a key that typed the layout's own symbol", () => {
    const commandHandlers = handlers()
    renderHook(() =>
      useUnifiedShortcutCapture({
        actions: [],
        builtInRules: [{ command: 'sidebar.toggle', shortcut: { key: '1', mod: true, alt: true } }],
        handlers: commandHandlers,
        onRunProjectAction: vi.fn(),
        terminalOpen: false,
      }),
    )
    const press = new KeyboardEvent('keydown', {
      key: '&',
      code: 'Digit1',
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
    // Chromium reports AltGraph for Ctrl+Alt on an AltGr layout even when no character results.
    Object.defineProperty(press, 'getModifierState', {
      value: (modifier: string) => modifier === 'AltGraph',
    })

    act(() => {
      window.dispatchEvent(press)
    })

    expect(commandHandlers['sidebar.toggle']).toHaveBeenCalledOnce()
  })
})
