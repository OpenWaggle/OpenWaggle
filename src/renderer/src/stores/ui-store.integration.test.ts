import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DIFF_PANEL_MAX, DIFF_PANEL_MIN, useUIStore } from './ui-store'

describe('useUIStore integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useUIStore.setState({
      settingsOpen: false,
      sidebarOpen: true,
      terminalOpen: false,
      activeView: 'chat',
      diffPanelOpen: false,
      diffPanelWidth: 600,
      toastMessage: null,
    })
  })

  afterEach(() => {
    useUIStore.getState().clearToast()
    vi.useRealTimers()
  })

  it('has correct defaults', () => {
    const s = useUIStore.getState()
    expect(s.settingsOpen).toBe(false)
    expect(s.sidebarOpen).toBe(true)
    expect(s.terminalOpen).toBe(false)
    expect(s.activeView).toBe('chat')
    expect(s.diffPanelOpen).toBe(false)
    expect(s.diffPanelWidth).toBe(600)
    expect(s.toastMessage).toBeNull()
  })

  it('toggleSidebar flips sidebarOpen', () => {
    useUIStore.getState().toggleSidebar()
    expect(useUIStore.getState().sidebarOpen).toBe(false)

    useUIStore.getState().toggleSidebar()
    expect(useUIStore.getState().sidebarOpen).toBe(true)
  })

  it('toggleTerminal flips terminalOpen', () => {
    useUIStore.getState().toggleTerminal()
    expect(useUIStore.getState().terminalOpen).toBe(true)

    useUIStore.getState().toggleTerminal()
    expect(useUIStore.getState().terminalOpen).toBe(false)
  })

  it('toggleDiffPanel flips diffPanelOpen', () => {
    useUIStore.getState().toggleDiffPanel()
    expect(useUIStore.getState().diffPanelOpen).toBe(true)

    useUIStore.getState().toggleDiffPanel()
    expect(useUIStore.getState().diffPanelOpen).toBe(false)
  })

  it('openSettings and closeSettings', () => {
    useUIStore.getState().openSettings()
    expect(useUIStore.getState().settingsOpen).toBe(true)

    useUIStore.getState().closeSettings()
    expect(useUIStore.getState().settingsOpen).toBe(false)
  })

  it('setActiveView updates the active view', () => {
    useUIStore.getState().setActiveView('skills')
    expect(useUIStore.getState().activeView).toBe('skills')

    useUIStore.getState().setActiveView('chat')
    expect(useUIStore.getState().activeView).toBe('chat')
  })

  it('openSkillsView sets skills view and closes diff panel', () => {
    useUIStore.setState({ diffPanelOpen: true })

    useUIStore.getState().openSkillsView()

    expect(useUIStore.getState().activeView).toBe('skills')
    expect(useUIStore.getState().diffPanelOpen).toBe(false)
  })

  it('resizeDiffPanel clamps to minimum', () => {
    useUIStore.setState({ diffPanelWidth: 400 })

    useUIStore.getState().resizeDiffPanel(-100)

    expect(useUIStore.getState().diffPanelWidth).toBe(DIFF_PANEL_MIN)
  })

  it('resizeDiffPanel clamps to maximum', () => {
    useUIStore.setState({ diffPanelWidth: 850 })

    useUIStore.getState().resizeDiffPanel(200)

    expect(useUIStore.getState().diffPanelWidth).toBe(DIFF_PANEL_MAX)
  })

  it('resizeDiffPanel applies delta within bounds', () => {
    useUIStore.setState({ diffPanelWidth: 500 })

    useUIStore.getState().resizeDiffPanel(50)

    expect(useUIStore.getState().diffPanelWidth).toBe(550)
  })

  it('closeTerminal sets terminalOpen to false', () => {
    useUIStore.setState({ terminalOpen: true })

    useUIStore.getState().closeTerminal()

    expect(useUIStore.getState().terminalOpen).toBe(false)
  })

  it('showToast sets message and auto-dismisses after 3500ms', () => {
    useUIStore.getState().showToast('Copied!')
    expect(useUIStore.getState().toastMessage).toBe('Copied!')

    vi.advanceTimersByTime(3499)
    expect(useUIStore.getState().toastMessage).toBe('Copied!')

    vi.advanceTimersByTime(1)
    expect(useUIStore.getState().toastMessage).toBeNull()
  })

  it('showToast replaces existing toast and resets timer', () => {
    useUIStore.getState().showToast('First')
    vi.advanceTimersByTime(2000)

    useUIStore.getState().showToast('Second')
    expect(useUIStore.getState().toastMessage).toBe('Second')

    vi.advanceTimersByTime(3499)
    expect(useUIStore.getState().toastMessage).toBe('Second')

    vi.advanceTimersByTime(1)
    expect(useUIStore.getState().toastMessage).toBeNull()
  })

  it('clearToast cancels pending timer and clears message', () => {
    useUIStore.getState().showToast('Will be cleared')
    vi.advanceTimersByTime(1000)

    useUIStore.getState().clearToast()
    expect(useUIStore.getState().toastMessage).toBeNull()

    vi.advanceTimersByTime(5000)
    expect(useUIStore.getState().toastMessage).toBeNull()
  })

  it('direct setState clears orphaned toast timer via subscribe', () => {
    useUIStore.getState().showToast('Will be externally cleared')
    vi.advanceTimersByTime(1000)

    // Bypass clearToast — simulate devtools or test resetting state directly
    useUIStore.setState({ toastMessage: null })
    expect(useUIStore.getState().toastMessage).toBeNull()

    // Set a new message manually; orphaned timer must not clear it
    useUIStore.setState({ toastMessage: 'Manually set' })
    vi.advanceTimersByTime(5000)
    expect(useUIStore.getState().toastMessage).toBe('Manually set')
  })
})
