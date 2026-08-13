import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import { DEFAULT_SHORTCUT_BINDINGS } from '@shared/types/shortcuts'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMock }))

import { usePreferencesStore } from '../../state/preferences-store'
import { ShortcutsSection } from '../sections/ShortcutsSection'

describe('ShortcutsSection', () => {
  let persistedSettings: Settings

  beforeEach(() => {
    vi.clearAllMocks()
    persistedSettings = DEFAULT_SETTINGS
    usePreferencesStore.setState({ settings: DEFAULT_SETTINGS })
    apiMock.updateSettings.mockImplementation(async (partial: Partial<Settings>) => {
      persistedSettings = { ...persistedSettings, ...partial }
      return { ok: true }
    })
    apiMock.getSettings.mockImplementation(async () => persistedSettings)
  })

  it('blocks resetting a shortcut when its default is assigned to another command', async () => {
    render(<ShortcutsSection />)

    const diffButton = screen.getByRole('button', { name: 'Change Toggle diff' })
    fireEvent.click(diffButton)
    fireEvent.keyDown(diffButton, { key: 'Backspace' })
    await waitFor(() => {
      expect(usePreferencesStore.getState().settings.shortcutBindings['diff.toggle']).toBeNull()
    })

    const sidebarButton = screen.getByRole('button', { name: 'Change Toggle sidebar' })
    fireEvent.click(sidebarButton)
    fireEvent.keyDown(sidebarButton, { key: 'd', ctrlKey: true })
    await waitFor(() => {
      expect(usePreferencesStore.getState().settings.shortcutBindings['sidebar.toggle']).toEqual({
        key: 'D',
        mod: true,
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Reset Toggle diff' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Already used by “Toggle sidebar”.')
    expect(apiMock.updateSettings).toHaveBeenCalledTimes(2)
    expect(usePreferencesStore.getState().settings.shortcutBindings).toEqual({
      ...DEFAULT_SHORTCUT_BINDINGS,
      'diff.toggle': null,
      'sidebar.toggle': { key: 'D', mod: true },
    })
  })
})
