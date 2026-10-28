import { detectPlatform, getHotkeyManager } from '@tanstack/react-hotkeys'
import { fireEvent, render, renderHook } from '@testing-library/react'
import { useLayoutEffect } from 'react'
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

  // PR 391 review R2 P3-2: options reached the manager in a passive effect, which can run after
  // paint, so a key pressed right after the render that enabled a hotkey still saw it disabled.
  it('has the options of a render in place before that render paints', () => {
    const pressed = vi.fn()
    function Overlay({ open }: { readonly open: boolean }) {
      useStableHotkey('Escape', pressed, options(open))
      return null
    }
    /** Presses Escape from a layout effect: after the commit, before passive effects and paint. */
    function PressAfterCommit({ open }: { readonly open: boolean }) {
      useLayoutEffect(() => {
        if (open) fireEvent.keyDown(document, { key: 'Escape' })
      }, [open])
      return null
    }
    const view = render(
      <>
        <Overlay open={false} />
        <PressAfterCommit open={false} />
      </>,
    )

    view.rerender(
      <>
        <Overlay open />
        <PressAfterCommit open />
      </>,
    )

    expect(pressed).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  // The manager parses `Mod` by platform itself; the hook also registers the canonical spelling,
  // as `useHotkey` does, so conflict checks compare the same strings.
  it('fires a platform-dependent hotkey on this platform', () => {
    const pressed = vi.fn()
    const view = renderHook(() => useStableHotkey('Mod+K', pressed, options(true)))
    const mac = detectPlatform() === 'mac'

    fireEvent.keyDown(document, { key: 'k', metaKey: mac, ctrlKey: !mac })

    expect(pressed).toHaveBeenCalledTimes(1)
    view.unmount()
  })
})
