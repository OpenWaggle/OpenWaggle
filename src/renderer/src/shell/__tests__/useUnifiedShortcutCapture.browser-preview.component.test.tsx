import type { BrowserPreviewKeyEvent } from '@shared/types/browser-preview'
import type { ProjectAction } from '@shared/types/project-actions'
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

function previewKeyEvent(overrides: Partial<BrowserPreviewKeyEvent> = {}): BrowserPreviewKeyEvent {
  return {
    previewId: 'preview-1',
    type: 'keydown',
    key: 'r',
    code: 'KeyR',
    altKey: false,
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    isComposing: false,
    repeat: false,
    ...overrides,
  }
}

describe('useUnifiedShortcutCapture native browser preview events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ipcMocks.listeners.clear()
  })

  it('registers only chords active in the exact live guest-preview context', () => {
    const action: ProjectAction = {
      id: 'tests',
      name: 'Run tests',
      command: 'pnpm test',
      icon: 'test',
      runOnWorktreeCreate: false,
      shortcutRules: [{ shortcut: { key: 'K', mod: true }, when: 'previewFocus' }],
    }
    const actions = [action]
    const builtInRules = [
      { command: 'preview.refresh', shortcut: { key: 'K', mod: true }, when: 'previewFocus' },
      { command: 'terminal.new', shortcut: { key: 'N', mod: true }, when: 'terminalFocus' },
      { command: 'terminal.toggle', shortcut: { key: 'T', mod: true }, when: 'terminalOpen' },
    ] as const
    const { rerender } = renderHook(
      ({ terminalOpen }) =>
        useUnifiedShortcutCapture({
          actions,
          builtInRules,
          handlers: handlers(),
          onRunProjectAction: vi.fn(),
          terminalOpen,
        }),
      { initialProps: { terminalOpen: false } },
    )

    expect(ipcMocks.setBindings).toHaveBeenCalledWith([{ key: 'K', mod: true }])

    rerender({ terminalOpen: true })

    expect(ipcMocks.setBindings).toHaveBeenLastCalledWith([
      { key: 'K', mod: true },
      { key: 'T', mod: true },
    ])
  })

  it('lets a Project Action win for preview focus', () => {
    const commandHandlers = handlers()
    const onRunProjectAction = vi.fn()
    const action: ProjectAction = {
      id: 'tests',
      name: 'Run tests',
      command: 'pnpm test',
      icon: 'test',
      runOnWorktreeCreate: false,
      shortcutRules: [{ shortcut: { key: 'R', mod: true }, when: 'previewFocus' }],
    }
    renderHook(() =>
      useUnifiedShortcutCapture({
        actions: [action],
        builtInRules: [
          { command: 'preview.refresh', shortcut: { key: 'R', mod: true }, when: 'previewFocus' },
        ],
        handlers: commandHandlers,
        onRunProjectAction,
        terminalOpen: false,
      }),
    )

    act(() => ipcMocks.emit(previewKeyEvent()))

    expect(onRunProjectAction).toHaveBeenCalledWith(action)
    expect(commandHandlers['preview.refresh']).not.toHaveBeenCalled()
  })

  it('dispatches a preview-focused built-in without a DOM target', () => {
    const commandHandlers = handlers()
    renderHook(() =>
      useUnifiedShortcutCapture({
        actions: [],
        builtInRules: [
          { command: 'preview.refresh', shortcut: { key: 'R', mod: true }, when: 'previewFocus' },
        ],
        handlers: commandHandlers,
        onRunProjectAction: vi.fn(),
        terminalOpen: false,
      }),
    )

    act(() => ipcMocks.emit(previewKeyEvent()))

    expect(commandHandlers['preview.refresh']).toHaveBeenCalledOnce()
  })

  it('suppresses repeats and never treats an open terminal as terminal focus', () => {
    const commandHandlers = handlers()
    const terminal = document.createElement('div')
    terminal.dataset.terminalPane = ''
    document.body.append(terminal)
    renderHook(() =>
      useUnifiedShortcutCapture({
        actions: [],
        builtInRules: [
          { command: 'preview.refresh', shortcut: { key: 'R', mod: true }, when: 'previewFocus' },
          { command: 'terminal.new', shortcut: { key: 'N', mod: true }, when: 'terminalFocus' },
        ],
        handlers: commandHandlers,
        onRunProjectAction: vi.fn(),
        terminalOpen: true,
      }),
    )

    act(() => {
      ipcMocks.emit(previewKeyEvent({ repeat: true }))
      ipcMocks.emit(previewKeyEvent({ key: 'n', code: 'KeyN' }))
    })

    expect(commandHandlers['preview.refresh']).not.toHaveBeenCalled()
    expect(commandHandlers['terminal.new']).not.toHaveBeenCalled()
  })
})
