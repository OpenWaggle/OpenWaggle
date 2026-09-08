import type { ProjectAction } from '@shared/types/project-actions'
import { DEFAULT_SHORTCUT_BINDINGS } from '@shared/types/shortcuts'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import { useProjectActionShortcutCapture } from '../useProjectActionShortcutCapture'

const ACTION: ProjectAction = {
  id: 'test',
  name: 'Test',
  command: 'pnpm test',
  icon: 'test',
  runOnWorktreeCreate: false,
  shortcutRules: [{ shortcut: { key: 'R', ctrl: true } }],
}

function keyboardEvent(type: 'keydown' | 'keyup', options: KeyboardEventInit) {
  return new KeyboardEvent(type, { bubbles: true, cancelable: true, ...options })
}

describe('useProjectActionShortcutCapture', () => {
  beforeEach(() => {
    useUIStore.setState({ commandSurface: null })
  })

  it('claims a real terminal-focused chord before xterm and consumes its modifier-free keyup', () => {
    const onRun = vi.fn()
    renderHook(() =>
      useProjectActionShortcutCapture({
        actions: [ACTION],
        builtInBindings: DEFAULT_SHORTCUT_BINDINGS,
        onRun,
      }),
    )
    const terminalInput = document.createElement('textarea')
    terminalInput.className = 'xterm-helper-textarea'
    document.body.append(terminalInput)
    terminalInput.focus()

    const keyDown = keyboardEvent('keydown', {
      key: 'r',
      code: 'KeyR',
      ctrlKey: true,
    })
    act(() => terminalInput.dispatchEvent(keyDown))
    expect(keyDown.defaultPrevented).toBe(true)
    expect(onRun).toHaveBeenCalledExactlyOnceWith(ACTION)

    const keyUp = keyboardEvent('keyup', { key: 'r', code: 'KeyR' })
    act(() => terminalInput.dispatchEvent(keyUp))
    expect(keyUp.defaultPrevented).toBe(true)
    expect(onRun).toHaveBeenCalledOnce()
    terminalInput.remove()
  })

  it('consumes repeats without rerunning and ignores shortcut-recording fields', () => {
    const onRun = vi.fn()
    renderHook(() =>
      useProjectActionShortcutCapture({
        actions: [ACTION],
        builtInBindings: DEFAULT_SHORTCUT_BINDINGS,
        onRun,
      }),
    )

    const initial = keyboardEvent('keydown', {
      key: 'r',
      code: 'KeyR',
      ctrlKey: true,
    })
    const repeat = keyboardEvent('keydown', {
      key: 'r',
      code: 'KeyR',
      ctrlKey: true,
      repeat: true,
    })
    act(() => {
      window.dispatchEvent(initial)
      window.dispatchEvent(repeat)
    })
    expect(repeat.defaultPrevented).toBe(true)
    expect(onRun).toHaveBeenCalledOnce()

    const recorder = document.createElement('button')
    recorder.dataset.projectActionShortcutInput = ''
    document.body.append(recorder)
    const recording = keyboardEvent('keydown', {
      key: 'r',
      code: 'KeyR',
      ctrlKey: true,
    })
    act(() => recorder.dispatchEvent(recording))
    expect(recording.defaultPrevented).toBe(false)
    expect(onRun).toHaveBeenCalledOnce()
    recorder.remove()
  })

  it('runs the latest matching action when bindings overlap', () => {
    const onRun = vi.fn()
    const duplicate = { ...ACTION, id: 'lint', name: 'Lint' }
    renderHook(() =>
      useProjectActionShortcutCapture({
        actions: [ACTION, duplicate],
        builtInBindings: DEFAULT_SHORTCUT_BINDINGS,
        onRun,
      }),
    )

    act(() => {
      window.dispatchEvent(keyboardEvent('keydown', { key: 'r', code: 'KeyR', ctrlKey: true }))
    })
    expect(onRun).toHaveBeenCalledExactlyOnceWith(duplicate)
  })

  it('runs modified bindings from typing fields and accepts hand-authored modifier-free rules', () => {
    const onRun = vi.fn()
    renderHook(() =>
      useProjectActionShortcutCapture({
        actions: [ACTION],
        builtInBindings: DEFAULT_SHORTCUT_BINDINGS,
        onRun,
      }),
    )
    const input = document.createElement('input')
    document.body.append(input)

    const typing = keyboardEvent('keydown', { key: 'r', code: 'KeyR', ctrlKey: true })
    act(() => input.dispatchEvent(typing))

    expect(typing.defaultPrevented).toBe(true)
    expect(onRun).toHaveBeenCalledExactlyOnceWith(ACTION)
    input.remove()

    const modifierFree = { ...ACTION, shortcutRules: [{ shortcut: { key: 'X' } }] }
    const modifierFreeRun = vi.fn()
    renderHook(() =>
      useProjectActionShortcutCapture({
        actions: [modifierFree],
        builtInBindings: DEFAULT_SHORTCUT_BINDINGS,
        onRun: modifierFreeRun,
      }),
    )
    const plainKey = keyboardEvent('keydown', { key: 'x', code: 'KeyX' })
    act(() => window.dispatchEvent(plainKey))
    expect(plainKey.defaultPrevented).toBe(true)
    expect(modifierFreeRun).toHaveBeenCalledExactlyOnceWith(modifierFree)
  })

  it('evaluates conditions and falls back through the global rule stack', () => {
    const onRun = vi.fn()
    const fallback: ProjectAction = {
      ...ACTION,
      id: 'fallback',
      name: 'Fallback',
      shortcutRules: [{ shortcut: { key: 'R', ctrl: true }, order: 0 }],
    }
    const terminalOnly: ProjectAction = {
      ...ACTION,
      id: 'terminal',
      name: 'Terminal',
      shortcutRules: [{ shortcut: { key: 'R', ctrl: true }, when: 'terminalFocus', order: 1 }],
    }
    renderHook(() =>
      useProjectActionShortcutCapture({
        actions: [fallback, terminalOnly],
        builtInBindings: DEFAULT_SHORTCUT_BINDINGS,
        onRun,
      }),
    )
    const terminal = document.createElement('section')
    terminal.dataset.terminalPane = ''
    const terminalInput = document.createElement('textarea')
    terminal.append(terminalInput)
    document.body.append(terminal)

    act(() =>
      window.dispatchEvent(keyboardEvent('keydown', { key: 'r', code: 'KeyR', ctrlKey: true })),
    )
    expect(onRun).toHaveBeenLastCalledWith(fallback)

    act(() =>
      terminalInput.dispatchEvent(
        keyboardEvent('keydown', { key: 'r', code: 'KeyR', ctrlKey: true }),
      ),
    )
    expect(onRun).toHaveBeenLastCalledWith(terminalOnly)
    terminal.remove()
  })

  it('leaves project bindings inactive while a command surface is open', () => {
    const onRun = vi.fn()
    renderHook(() =>
      useProjectActionShortcutCapture({
        actions: [ACTION],
        builtInBindings: DEFAULT_SHORTCUT_BINDINGS,
        onRun,
      }),
    )
    useUIStore.setState({ commandSurface: 'commands' })

    const event = keyboardEvent('keydown', { key: 'r', code: 'KeyR', ctrlKey: true })
    act(() => window.dispatchEvent(event))

    expect(event.defaultPrevented).toBe(false)
    expect(onRun).not.toHaveBeenCalled()
  })
})
