import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '../ui-store'

describe('useUIStore unit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useUIStore.setState({
      settingsOpen: false,
      sidebarOpen: true,
      terminalOpen: false,
      activeView: 'chat',
      activeSettingsTab: 'general',
      diffPanelOpen: false,
      diffPanelWidth: 600,
      diffRefreshKey: 0,
      toastMessage: null,
      commandPaletteOpen: false,
    })
  })

  afterEach(() => {
    useUIStore.getState().clearToast()
    vi.useRealTimers()
  })

  // ── openSettings with specific tab ──

  describe('openSettings', () => {
    it('opens settings with a specific tab', () => {
      useUIStore.getState().openSettings('connections')

      const s = useUIStore.getState()
      expect(s.settingsOpen).toBe(true)
      expect(s.activeView).toBe('settings')
      expect(s.activeSettingsTab).toBe('connections')
      expect(s.diffPanelOpen).toBe(false)
    })

    it('defaults to general tab when no tab is provided', () => {
      useUIStore.getState().openSettings()

      expect(useUIStore.getState().activeSettingsTab).toBe('general')
    })

    it('closes diff panel when opening settings', () => {
      useUIStore.setState({ diffPanelOpen: true })

      useUIStore.getState().openSettings('git')

      expect(useUIStore.getState().diffPanelOpen).toBe(false)
      expect(useUIStore.getState().activeSettingsTab).toBe('git')
    })
  })

  // ── setActiveSettingsTab ──

  describe('setActiveSettingsTab', () => {
    it('updates the active settings tab', () => {
      useUIStore.getState().setActiveSettingsTab('waggle')

      expect(useUIStore.getState().activeSettingsTab).toBe('waggle')
    })

    it('can switch between different tabs', () => {
      useUIStore.getState().setActiveSettingsTab('environments')
      expect(useUIStore.getState().activeSettingsTab).toBe('environments')

      useUIStore.getState().setActiveSettingsTab('personalization')
      expect(useUIStore.getState().activeSettingsTab).toBe('personalization')
    })
  })

  // ── bumpDiffRefreshKey ──

  describe('bumpDiffRefreshKey', () => {
    it('increments the diffRefreshKey by 1', () => {
      expect(useUIStore.getState().diffRefreshKey).toBe(0)

      useUIStore.getState().bumpDiffRefreshKey()
      expect(useUIStore.getState().diffRefreshKey).toBe(1)

      useUIStore.getState().bumpDiffRefreshKey()
      expect(useUIStore.getState().diffRefreshKey).toBe(2)
    })
  })

  // ── command palette ──

  describe('command palette', () => {
    it('openCommandPalette sets commandPaletteOpen to true', () => {
      useUIStore.getState().openCommandPalette()

      expect(useUIStore.getState().commandPaletteOpen).toBe(true)
    })

    it('closeCommandPalette sets commandPaletteOpen to false', () => {
      useUIStore.setState({ commandPaletteOpen: true })

      useUIStore.getState().closeCommandPalette()

      expect(useUIStore.getState().commandPaletteOpen).toBe(false)
    })

    it('toggleCommandPalette flips commandPaletteOpen', () => {
      expect(useUIStore.getState().commandPaletteOpen).toBe(false)

      useUIStore.getState().toggleCommandPalette()
      expect(useUIStore.getState().commandPaletteOpen).toBe(true)

      useUIStore.getState().toggleCommandPalette()
      expect(useUIStore.getState().commandPaletteOpen).toBe(false)
    })
  })

  // ── clearToast edge case ──

  describe('clearToast', () => {
    it('is safe to call when no toast timer is active', () => {
      // No showToast was called, so no timer exists
      expect(useUIStore.getState().toastMessage).toBeNull()

      useUIStore.getState().clearToast()

      expect(useUIStore.getState().toastMessage).toBeNull()
    })
  })

  // ── closeSettings ──

  describe('closeSettings', () => {
    it('resets activeView to chat and settingsOpen to false', () => {
      useUIStore.setState({ activeView: 'settings', settingsOpen: true })

      useUIStore.getState().closeSettings()

      expect(useUIStore.getState().activeView).toBe('chat')
      expect(useUIStore.getState().settingsOpen).toBe(false)
    })
  })
})
