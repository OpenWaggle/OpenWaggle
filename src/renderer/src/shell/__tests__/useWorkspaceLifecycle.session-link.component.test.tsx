import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
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

  it('does nothing on a page that shows no Session', () => {
    lifecycleMocks.viewedSessionId = null
    renderHook(() => useWorkspaceLifecycle())

    act(() => runWorkspaceHotkey('Mod+Alt+L'))

    expect(lifecycleMocks.copySessionLink).not.toHaveBeenCalled()
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
})
