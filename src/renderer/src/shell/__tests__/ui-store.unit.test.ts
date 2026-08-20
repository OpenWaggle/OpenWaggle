import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '../ui-store'

describe('useUIStore unit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useUIStore.setState({
      sidebarOpen: true,
      terminalOpen: false,
      activeView: 'chat',
      activeSettingsTab: 'general',
      diffRefreshKey: 0,
      toastMessage: null,
      toastData: null,
      slashCommandMenuOpen: false,
      feedbackModalOpen: false,
    })
  })

  afterEach(() => {
    useUIStore.getState().clearToast()
    vi.useRealTimers()
  })

  describe('route-projected view state', () => {
    it('stores the active view projected by the current route', () => {
      useUIStore.getState().setActiveView('settings')
      expect(useUIStore.getState().activeView).toBe('settings')

      useUIStore.getState().setActiveView('chat')
      expect(useUIStore.getState().activeView).toBe('chat')
    })

    it('stores the active settings tab projected by the current route', () => {
      useUIStore.getState().setActiveSettingsTab('waggle')
      expect(useUIStore.getState().activeSettingsTab).toBe('waggle')
    })
  })

  describe('bumpDiffRefreshKey', () => {
    it('increments the diffRefreshKey', () => {
      expect(useUIStore.getState().diffRefreshKey).toBe(0)

      useUIStore.getState().bumpDiffRefreshKey()
      useUIStore.getState().bumpDiffRefreshKey()

      expect(useUIStore.getState().diffRefreshKey).toBe(2)
    })
  })

  describe('slash command menu', () => {
    it('opens and closes slashCommandMenuOpen', () => {
      useUIStore.getState().openSlashCommandMenu()
      expect(useUIStore.getState().slashCommandMenuOpen).toBe(true)

      useUIStore.getState().closeSlashCommandMenu()
      expect(useUIStore.getState().slashCommandMenuOpen).toBe(false)
    })
  })

  describe('clearToast', () => {
    it('is safe when no toast timer is active', () => {
      expect(useUIStore.getState().toastMessage).toBeNull()

      useUIStore.getState().clearToast()

      expect(useUIStore.getState().toastMessage).toBeNull()
    })
  })
})
