import { extensionRightPanelSurfaceId } from '@shared/types/right-panel-surface-id'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { usePreferencesStore } from '../../state'
import { useRightPanelSurfaceShortcut } from '../useRightPanelSurfaceShortcut'

const NOTES = extensionRightPanelSurfaceId({ extensionId: 'acme.notes', sidePanelId: 'notes' })

describe('useRightPanelSurfaceShortcut', () => {
  beforeEach(() => {
    usePreferencesStore.setState({ settings: DEFAULT_SETTINGS })
  })

  it('returns the Shortcut registry binding of a built-in surface', () => {
    const { result } = renderHook(() => useRightPanelSurfaceShortcut('changes'))

    expect(result.current).toEqual({ binding: { key: 'D', mod: true }, label: 'Ctrl + D' })
  })

  it('reports unassigned surfaces with null', () => {
    const { result } = renderHook(() => useRightPanelSurfaceShortcut('files'))

    expect(result.current).toEqual({ binding: null, label: null })
  })

  it('follows the user binding of an extension side panel', () => {
    const { result } = renderHook(() => useRightPanelSurfaceShortcut(NOTES))
    expect(result.current.binding).toBeNull()

    act(() =>
      usePreferencesStore.setState({
        settings: {
          ...DEFAULT_SETTINGS,
          extensionPanelShortcutBindings: { [NOTES]: { key: 'G', mod: true, shift: true } },
        },
      }),
    )

    expect(result.current).toEqual({
      binding: { key: 'G', mod: true, shift: true },
      label: 'Ctrl + Shift + G',
    })
  })
})
