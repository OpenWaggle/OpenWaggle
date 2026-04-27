import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '../ui-store'

describe('useUIStore integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useUIStore.setState({
      sidebarOpen: true,
      terminalOpen: false,
      activeView: 'chat',
      activeSettingsTab: 'general',
      toastMessage: null,
      toastData: null,
      commandPaletteOpen: false,
    })
  })

  afterEach(() => {
    useUIStore.getState().clearToast()
    vi.useRealTimers()
  })

  it('has route-independent UI defaults', () => {
    const state = useUIStore.getState()

    expect(state.sidebarOpen).toBe(true)
    expect(state.terminalOpen).toBe(false)
    expect(state.activeView).toBe('chat')
    expect(state.activeSettingsTab).toBe('general')
    expect(state.toastMessage).toBeNull()
  })

  it('toggles shell chrome state', () => {
    useUIStore.getState().toggleSidebar()
    expect(useUIStore.getState().sidebarOpen).toBe(false)

    useUIStore.getState().toggleTerminal()
    expect(useUIStore.getState().terminalOpen).toBe(true)

    useUIStore.getState().closeTerminal()
    expect(useUIStore.getState().terminalOpen).toBe(false)
  })

  it('stores route projections for the active view and settings tab', () => {
    useUIStore.getState().setActiveView('skills')
    useUIStore.getState().setActiveSettingsTab('connections')

    expect(useUIStore.getState().activeView).toBe('skills')
    expect(useUIStore.getState().activeSettingsTab).toBe('connections')
  })

  it('showToast sets message and auto-dismisses after the toast delay', () => {
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

    useUIStore.setState({ toastMessage: null })
    expect(useUIStore.getState().toastMessage).toBeNull()

    useUIStore.setState({ toastMessage: 'Manually set' })
    vi.advanceTimersByTime(5000)
    expect(useUIStore.getState().toastMessage).toBe('Manually set')
  })
})
