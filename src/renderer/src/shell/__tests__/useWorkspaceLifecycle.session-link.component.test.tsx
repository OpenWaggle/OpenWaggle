import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getWorkspaceLifecycleMocks,
  loadUseWorkspaceLifecycle,
  resetWorkspaceLifecycleMocks,
  runWorkspaceHotkey,
} from './useWorkspaceLifecycle.test-harness'

const lifecycleMocks = getWorkspaceLifecycleMocks()

describe('useWorkspaceLifecycle Session link shortcut', () => {
  let useWorkspaceLifecycle: Awaited<
    ReturnType<typeof loadUseWorkspaceLifecycle>
  >['useWorkspaceLifecycle']

  beforeEach(async () => {
    resetWorkspaceLifecycleMocks()
    ;({ useWorkspaceLifecycle } = await loadUseWorkspaceLifecycle())
  })

  it('copies the link of the Session the route shows', () => {
    lifecycleMocks.viewedSessionId = 'session-shown'
    renderHook(() => useWorkspaceLifecycle())

    act(() => runWorkspaceHotkey('Mod+Alt+L'))

    expect(lifecycleMocks.copySessionLink).toHaveBeenCalledWith('session-shown')
  })

  it('leaves the chord to the focused field on a page that shows no Session', () => {
    lifecycleMocks.viewedSessionId = null
    renderHook(() => useWorkspaceLifecycle())
    const press = new KeyboardEvent('keydown', {
      key: 'l',
      code: 'KeyL',
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    })

    act(() => {
      window.dispatchEvent(press)
    })

    expect(lifecycleMocks.copySessionLink).not.toHaveBeenCalled()
    expect(press.defaultPrevented).toBe(false)
  })

  it('still copies while a terminal has focus', () => {
    renderHook(() => useWorkspaceLifecycle())
    const pane = document.createElement('div')
    pane.dataset.terminalPane = 'term-1'
    const textarea = document.createElement('textarea')
    pane.append(textarea)
    document.body.append(pane)

    act(() => runWorkspaceHotkey('Mod+Alt+L', textarea))

    expect(lifecycleMocks.copySessionLink).toHaveBeenCalledWith('session-1')
    pane.remove()
  })

  it('lets a page in the browser preview keep the chord when no Session is shown', async () => {
    // The harness mocks the IPC bridge, so read it after the harness has loaded.
    const { api } = await import('@/shared/lib/ipc')
    const copyLinkChord = { key: 'L', mod: true, alt: true }
    const registered = () => vi.mocked(api.setBrowserPreviewShortcutBindings).mock.lastCall?.[0]

    lifecycleMocks.viewedSessionId = null
    const { unmount } = renderHook(() => useWorkspaceLifecycle())
    expect(registered()).not.toContainEqual(copyLinkChord)
    unmount()

    lifecycleMocks.viewedSessionId = 'session-1'
    renderHook(() => useWorkspaceLifecycle())
    expect(registered()).toContainEqual(copyLinkChord)
  })
})
