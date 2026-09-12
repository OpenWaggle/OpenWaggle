import type { BrowserPreviewKeyEvent } from '@shared/types/browser-preview'
import type { ProjectAction } from '@shared/types/project-actions'
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
  }
}

function keyEvent(type: 'keydown' | 'keyup', repeat = false) {
  return new KeyboardEvent(type, {
    key: 'd',
    code: 'KeyD',
    ctrlKey: true,
    repeat,
    bubbles: true,
    cancelable: true,
  })
}

describe('useUnifiedShortcutCapture', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcMocks.listeners.clear()
  })

  it('dispatches one newest active command and consumes its paired release', () => {
    const commandHandlers = handlers()
    renderHook(() =>
      useUnifiedShortcutCapture({
        actions: [],
        builtInRules: [
          { command: 'diff.toggle', shortcut: { key: 'D', mod: true } },
          { command: 'sidebar.toggle', shortcut: { key: 'D', mod: true } },
        ],
        handlers: commandHandlers,
        onRunProjectAction: vi.fn(),
        terminalOpen: false,
      }),
    )
    const down = keyEvent('keydown')
    const up = keyEvent('keyup')
    act(() => {
      window.dispatchEvent(down)
      window.dispatchEvent(up)
    })

    expect(commandHandlers['sidebar.toggle']).toHaveBeenCalledOnce()
    expect(commandHandlers['diff.toggle']).not.toHaveBeenCalled()
    expect(down.defaultPrevented).toBe(true)
    expect(up.defaultPrevented).toBe(true)
  })

  it('places an active Project Action over the same built-in chord', () => {
    const commandHandlers = handlers()
    const onRunProjectAction = vi.fn()
    const action: ProjectAction = {
      id: 'tests',
      name: 'Run tests',
      command: 'pnpm test',
      icon: 'test',
      runOnWorktreeCreate: false,
      shortcutRules: [{ shortcut: { key: 'D', mod: true } }],
    }
    renderHook(() =>
      useUnifiedShortcutCapture({
        actions: [action],
        builtInRules: DEFAULT_SHORTCUT_RULES,
        handlers: commandHandlers,
        onRunProjectAction,
        terminalOpen: false,
      }),
    )

    act(() => window.dispatchEvent(keyEvent('keydown')))
    expect(onRunProjectAction).toHaveBeenCalledWith(action)
    expect(commandHandlers['diff.toggle']).not.toHaveBeenCalled()
  })

  it('never steals a chord while the keybinding recorder owns focus', () => {
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
    const capture = document.createElement('button')
    capture.dataset.shortcutCapture = ''
    document.body.append(capture)
    const event = keyEvent('keydown')
    act(() => capture.dispatchEvent(event))

    expect(event.defaultPrevented).toBe(false)
    expect(commandHandlers['diff.toggle']).not.toHaveBeenCalled()
  })

  it('claims a terminal-context command once before the terminal target sees it', () => {
    const commandHandlers = handlers()
    renderHook(() =>
      useUnifiedShortcutCapture({
        actions: [],
        builtInRules: [
          { command: 'terminal.split', shortcut: { key: 'D', mod: true }, when: 'terminalFocus' },
        ],
        handlers: commandHandlers,
        onRunProjectAction: vi.fn(),
        terminalOpen: true,
      }),
    )
    const pane = document.createElement('div')
    pane.dataset.terminalPane = 'terminal-1'
    const input = document.createElement('textarea')
    pane.append(input)
    document.body.append(pane)
    const targetKeyDown = vi.fn()
    input.addEventListener('keydown', targetKeyDown)
    const press = new KeyboardEvent('keydown', {
      key: 'd',
      code: 'KeyD',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    const repeat = new KeyboardEvent('keydown', {
      key: 'd',
      code: 'KeyD',
      ctrlKey: true,
      repeat: true,
      bubbles: true,
      cancelable: true,
    })

    act(() => {
      input.dispatchEvent(press)
      input.dispatchEvent(repeat)
    })

    expect(commandHandlers['terminal.split']).toHaveBeenCalledOnce()
    expect(press.defaultPrevented).toBe(true)
    expect(repeat.defaultPrevented).toBe(true)
    expect(targetKeyDown).not.toHaveBeenCalled()
  })

  it('leaves close-window semantics untouched when no right-panel surface is active', () => {
    const commandHandlers = handlers()
    const { rerender } = renderHook(
      ({ active }) =>
        useUnifiedShortcutCapture({
          actions: [],
          builtInRules: [
            {
              command: 'rightPanel.close',
              shortcut: { key: 'W', mod: true },
              when: '!terminalFocus',
            },
          ],
          handlers: commandHandlers,
          onRunProjectAction: vi.fn(),
          shouldHandleBuiltIn: () => active,
          terminalOpen: false,
        }),
      { initialProps: { active: false } },
    )
    const unavailable = new KeyboardEvent('keydown', {
      key: 'w',
      code: 'KeyW',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })

    act(() => window.dispatchEvent(unavailable))

    expect(unavailable.defaultPrevented).toBe(false)
    expect(commandHandlers['rightPanel.close']).not.toHaveBeenCalled()

    rerender({ active: true })
    const available = new KeyboardEvent('keydown', {
      key: 'w',
      code: 'KeyW',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    act(() => window.dispatchEvent(available))

    expect(available.defaultPrevented).toBe(true)
    expect(commandHandlers['rightPanel.close']).toHaveBeenCalledOnce()
  })

  it('keeps preview toggle global while default preview commands require preview focus', () => {
    const commandHandlers = handlers()
    renderHook(() =>
      useUnifiedShortcutCapture({
        actions: [],
        builtInRules: [
          { command: 'preview.toggle', shortcut: { key: 'J', mod: true, shift: true } },
          { command: 'preview.refresh', shortcut: { key: 'R', mod: true }, when: 'previewFocus' },
        ],
        handlers: commandHandlers,
        onRunProjectAction: vi.fn(),
        terminalOpen: false,
      }),
    )
    const refreshWithoutPreview = new KeyboardEvent('keydown', {
      key: 'r',
      code: 'KeyR',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    const toggleWithoutPreview = new KeyboardEvent('keydown', {
      key: 'j',
      code: 'KeyJ',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })

    act(() => {
      window.dispatchEvent(refreshWithoutPreview)
      window.dispatchEvent(toggleWithoutPreview)
    })

    expect(refreshWithoutPreview.defaultPrevented).toBe(false)
    expect(commandHandlers['preview.refresh']).not.toHaveBeenCalled()
    expect(toggleWithoutPreview.defaultPrevented).toBe(true)
    expect(commandHandlers['preview.toggle']).toHaveBeenCalledOnce()
  })
})
