import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DIFF_PANEL_MAX, DIFF_PANEL_MIN, useUIStore } from './ui-store'

describe('useUIStore — extra coverage', () => {
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

  // ── toggleSidebar ──

  describe('toggleSidebar', () => {
    it('closes sidebar when open', () => {
      expect(useUIStore.getState().sidebarOpen).toBe(true)

      useUIStore.getState().toggleSidebar()

      expect(useUIStore.getState().sidebarOpen).toBe(false)
    })

    it('opens sidebar when closed', () => {
      useUIStore.setState({ sidebarOpen: false })

      useUIStore.getState().toggleSidebar()

      expect(useUIStore.getState().sidebarOpen).toBe(true)
    })
  })

  // ── toggleTerminal ──

  describe('toggleTerminal', () => {
    it('opens terminal when closed', () => {
      expect(useUIStore.getState().terminalOpen).toBe(false)

      useUIStore.getState().toggleTerminal()

      expect(useUIStore.getState().terminalOpen).toBe(true)
    })

    it('closes terminal when open', () => {
      useUIStore.setState({ terminalOpen: true })

      useUIStore.getState().toggleTerminal()

      expect(useUIStore.getState().terminalOpen).toBe(false)
    })
  })

  // ── closeTerminal ──

  describe('closeTerminal', () => {
    it('sets terminalOpen to false', () => {
      useUIStore.setState({ terminalOpen: true })

      useUIStore.getState().closeTerminal()

      expect(useUIStore.getState().terminalOpen).toBe(false)
    })

    it('is idempotent when already closed', () => {
      expect(useUIStore.getState().terminalOpen).toBe(false)

      useUIStore.getState().closeTerminal()

      expect(useUIStore.getState().terminalOpen).toBe(false)
    })
  })

  // ── toggleDiffPanel ──

  describe('toggleDiffPanel', () => {
    it('opens diff panel when closed', () => {
      expect(useUIStore.getState().diffPanelOpen).toBe(false)

      useUIStore.getState().toggleDiffPanel()

      expect(useUIStore.getState().diffPanelOpen).toBe(true)
    })

    it('closes diff panel when open', () => {
      useUIStore.setState({ diffPanelOpen: true })

      useUIStore.getState().toggleDiffPanel()

      expect(useUIStore.getState().diffPanelOpen).toBe(false)
    })
  })

  // ── setActiveView ──

  describe('setActiveView', () => {
    it('sets view to skills', () => {
      useUIStore.getState().setActiveView('skills')

      expect(useUIStore.getState().activeView).toBe('skills')
    })

    it('sets view to settings', () => {
      useUIStore.getState().setActiveView('settings')

      expect(useUIStore.getState().activeView).toBe('settings')
    })

    it('sets view to chat', () => {
      useUIStore.setState({ activeView: 'settings' })

      useUIStore.getState().setActiveView('chat')

      expect(useUIStore.getState().activeView).toBe('chat')
    })
  })

  // ── openSkillsView ──

  describe('openSkillsView', () => {
    it('sets activeView to skills', () => {
      useUIStore.getState().openSkillsView()

      expect(useUIStore.getState().activeView).toBe('skills')
    })

    it('closes the diff panel', () => {
      useUIStore.setState({ diffPanelOpen: true })

      useUIStore.getState().openSkillsView()

      expect(useUIStore.getState().diffPanelOpen).toBe(false)
    })

    it('sets skills view and closes diff panel together', () => {
      useUIStore.setState({ activeView: 'chat', diffPanelOpen: true })

      useUIStore.getState().openSkillsView()

      const state = useUIStore.getState()
      expect(state.activeView).toBe('skills')
      expect(state.diffPanelOpen).toBe(false)
    })
  })

  // ── resizeDiffPanel ──

  describe('resizeDiffPanel', () => {
    it('increases width by positive delta', () => {
      useUIStore.getState().resizeDiffPanel(50)

      expect(useUIStore.getState().diffPanelWidth).toBe(650)
    })

    it('decreases width by negative delta', () => {
      useUIStore.getState().resizeDiffPanel(-100)

      expect(useUIStore.getState().diffPanelWidth).toBe(500)
    })

    it('clamps to minimum when delta would go below DIFF_PANEL_MIN', () => {
      // Default width is 600, so -300 would be 300, below min of 360
      useUIStore.getState().resizeDiffPanel(-300)

      expect(useUIStore.getState().diffPanelWidth).toBe(DIFF_PANEL_MIN)
    })

    it('clamps to maximum when delta would exceed DIFF_PANEL_MAX', () => {
      // Default width is 600, so +400 would be 1000, above max of 900
      useUIStore.getState().resizeDiffPanel(400)

      expect(useUIStore.getState().diffPanelWidth).toBe(DIFF_PANEL_MAX)
    })

    it('stays at minimum when already at min and delta is negative', () => {
      useUIStore.setState({ diffPanelWidth: DIFF_PANEL_MIN })

      useUIStore.getState().resizeDiffPanel(-50)

      expect(useUIStore.getState().diffPanelWidth).toBe(DIFF_PANEL_MIN)
    })

    it('stays at maximum when already at max and delta is positive', () => {
      useUIStore.setState({ diffPanelWidth: DIFF_PANEL_MAX })

      useUIStore.getState().resizeDiffPanel(50)

      expect(useUIStore.getState().diffPanelWidth).toBe(DIFF_PANEL_MAX)
    })

    it('allows exact min value', () => {
      useUIStore.setState({ diffPanelWidth: 400 })

      useUIStore.getState().resizeDiffPanel(DIFF_PANEL_MIN - 400)

      expect(useUIStore.getState().diffPanelWidth).toBe(DIFF_PANEL_MIN)
    })

    it('allows exact max value', () => {
      useUIStore.setState({ diffPanelWidth: 800 })

      useUIStore.getState().resizeDiffPanel(DIFF_PANEL_MAX - 800)

      expect(useUIStore.getState().diffPanelWidth).toBe(DIFF_PANEL_MAX)
    })
  })

  // ── showToast ──

  describe('showToast', () => {
    it('sets toastMessage', () => {
      useUIStore.getState().showToast('Hello world')

      expect(useUIStore.getState().toastMessage).toBe('Hello world')
    })

    it('auto-clears after 3500ms', () => {
      useUIStore.getState().showToast('Temporary')

      expect(useUIStore.getState().toastMessage).toBe('Temporary')

      vi.advanceTimersByTime(3499)
      expect(useUIStore.getState().toastMessage).toBe('Temporary')

      vi.advanceTimersByTime(1)
      expect(useUIStore.getState().toastMessage).toBeNull()
    })

    it('replaces a previous toast and resets the timer', () => {
      useUIStore.getState().showToast('First')

      vi.advanceTimersByTime(2000)
      useUIStore.getState().showToast('Second')

      expect(useUIStore.getState().toastMessage).toBe('Second')

      // The old timer (1500ms remaining) should NOT clear it
      vi.advanceTimersByTime(1500)
      expect(useUIStore.getState().toastMessage).toBe('Second')

      // New timer should clear at 3500ms from "Second"
      vi.advanceTimersByTime(2000)
      expect(useUIStore.getState().toastMessage).toBeNull()
    })
  })

  // ── clearToast ──

  describe('clearToast', () => {
    it('clears an active toast message', () => {
      useUIStore.getState().showToast('Active toast')

      useUIStore.getState().clearToast()

      expect(useUIStore.getState().toastMessage).toBeNull()
    })

    it('cancels the auto-clear timer', () => {
      useUIStore.getState().showToast('Will be cleared')

      useUIStore.getState().clearToast()

      // Set a new toast to verify old timer is dead
      useUIStore.setState({ toastMessage: 'New toast' })

      vi.advanceTimersByTime(3500)

      // The old timer should not have cleared this new toast
      // (toast subscription handles external clears, but the timer itself was cancelled)
      expect(useUIStore.getState().toastMessage).toBe('New toast')
    })
  })

  // ── openSettings edge cases ──

  describe('openSettings — additional', () => {
    it('opens settings with environments tab', () => {
      useUIStore.getState().openSettings('environments')

      const state = useUIStore.getState()
      expect(state.activeView).toBe('settings')
      expect(state.settingsOpen).toBe(true)
      expect(state.activeSettingsTab).toBe('environments')
    })

    it('opens settings with worktrees tab', () => {
      useUIStore.getState().openSettings('worktrees')

      expect(useUIStore.getState().activeSettingsTab).toBe('worktrees')
    })

    it('opens settings with archived tab', () => {
      useUIStore.getState().openSettings('archived')

      expect(useUIStore.getState().activeSettingsTab).toBe('archived')
    })
  })

  // ── subscription: toast timer cleanup ──

  describe('subscription — toast timer cleanup', () => {
    it('cleans up timer when toastMessage is set to null externally', () => {
      useUIStore.getState().showToast('Toast with timer')

      // Externally clear the toast (like a direct setState in code)
      useUIStore.setState({ toastMessage: null })

      // The subscription should have cleaned up the timer.
      // Verify by showing a new toast -- if old timer wasn't cleaned,
      // it could interfere.
      useUIStore.getState().showToast('New toast')

      vi.advanceTimersByTime(3500)
      expect(useUIStore.getState().toastMessage).toBeNull()
    })
  })
})
