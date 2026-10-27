import { getHotkeyManager } from '@tanstack/react-hotkeys'
import { fireEvent, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type StableHotkeyOptions, useStableHotkey } from '../useStableHotkey'

const RERENDERS = 50

function options(enabled: boolean): StableHotkeyOptions {
  return {
    enabled,
    preventDefault: true,
    stopPropagation: true,
    ignoreInputs: false,
    conflictBehavior: 'allow',
  }
}

describe('useStableHotkey', () => {
  afterEach(() => vi.restoreAllMocks())

  it('fires the latest callback while enabled', () => {
    const first = vi.fn()
    const latest = vi.fn()
    const view = renderHook(
      ({ callback, enabled }) => useStableHotkey('Enter', callback, options(enabled)),
      {
        initialProps: { callback: first, enabled: true },
      },
    )
    view.rerender({ callback: latest, enabled: true })

    fireEvent.keyDown(document, { key: 'Enter' })
    expect(first).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledTimes(1)

    view.rerender({ callback: latest, enabled: false })
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(latest).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it('does not touch the hotkey manager when it re-renders with the same options', () => {
    const view = renderHook(({ callback }) => useStableHotkey('Escape', callback, options(true)), {
      initialProps: { callback: vi.fn() },
    })
    // `useHotkey` called setOptions per render, copying every registration and notifying.
    const setState = vi.spyOn(getHotkeyManager().registrations, 'setState')

    for (let index = 0; index < RERENDERS; index += 1) view.rerender({ callback: vi.fn() })

    expect(setState).not.toHaveBeenCalled()
    view.unmount()
  })
})
