import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '../ui-store'

describe('useUIStore — extra coverage', () => {
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
      commandPaletteOpen: false,
      feedbackModalOpen: false,
    })
  })

  afterEach(() => {
    useUIStore.getState().clearToast()
    vi.useRealTimers()
  })

  describe('toggleSidebar', () => {
    it('closes sidebar when open and opens it when closed', () => {
      expect(useUIStore.getState().sidebarOpen).toBe(true)

      useUIStore.getState().toggleSidebar()
      expect(useUIStore.getState().sidebarOpen).toBe(false)

      useUIStore.getState().toggleSidebar()
      expect(useUIStore.getState().sidebarOpen).toBe(true)
    })
  })

  describe('toggleTerminal', () => {
    it('opens terminal when closed and closes it when open', () => {
      expect(useUIStore.getState().terminalOpen).toBe(false)

      useUIStore.getState().toggleTerminal()
      expect(useUIStore.getState().terminalOpen).toBe(true)

      useUIStore.getState().toggleTerminal()
      expect(useUIStore.getState().terminalOpen).toBe(false)
    })
  })

  describe('closeTerminal', () => {
    it('sets terminalOpen to false idempotently', () => {
      useUIStore.setState({ terminalOpen: true })

      useUIStore.getState().closeTerminal()
      useUIStore.getState().closeTerminal()

      expect(useUIStore.getState().terminalOpen).toBe(false)
    })
  })

  describe('setActiveView', () => {
    it('sets each route-projected view', () => {
      useUIStore.getState().setActiveView('skills')
      expect(useUIStore.getState().activeView).toBe('skills')

      useUIStore.getState().setActiveView('settings')
      expect(useUIStore.getState().activeView).toBe('settings')

      useUIStore.getState().setActiveView('chat')
      expect(useUIStore.getState().activeView).toBe('chat')
    })
  })

  describe('showToast', () => {
    it('sets toastMessage', () => {
      useUIStore.getState().showToast('Hello world')

      expect(useUIStore.getState().toastMessage).toBe('Hello world')
    })

    it('auto-clears after the toast delay', () => {
      useUIStore.getState().showToast('Temporary')

      vi.advanceTimersByTime(3499)
      expect(useUIStore.getState().toastMessage).toBe('Temporary')

      vi.advanceTimersByTime(1)
      expect(useUIStore.getState().toastMessage).toBeNull()
    })

    it('replaces a previous toast and resets the timer', () => {
      useUIStore.getState().showToast('First')

      vi.advanceTimersByTime(2000)
      useUIStore.getState().showToast('Second')

      vi.advanceTimersByTime(1500)
      expect(useUIStore.getState().toastMessage).toBe('Second')

      vi.advanceTimersByTime(2000)
      expect(useUIStore.getState().toastMessage).toBeNull()
    })
  })

  describe('clearToast', () => {
    it('clears an active toast and cancels the auto-clear timer', () => {
      useUIStore.getState().showToast('Active toast')

      useUIStore.getState().clearToast()
      useUIStore.setState({ toastMessage: 'New toast' })
      vi.advanceTimersByTime(3500)

      expect(useUIStore.getState().toastMessage).toBe('New toast')
    })
  })

  describe('subscription — toast timer cleanup', () => {
    it('cleans up timer when toastMessage is set to null externally', () => {
      useUIStore.getState().showToast('Toast with timer')

      useUIStore.setState({ toastMessage: null })
      useUIStore.getState().showToast('New toast')

      vi.advanceTimersByTime(3500)
      expect(useUIStore.getState().toastMessage).toBeNull()
    })
  })
})
