import { create } from 'zustand'

export const DIFF_PANEL_MIN = 360
export const DIFF_PANEL_MAX = 900
export const CHAT_MIN_WIDTH = 420

interface UIState {
  settingsOpen: boolean
  sidebarOpen: boolean
  terminalOpen: boolean
  activeView: 'chat' | 'skills'
  diffPanelOpen: boolean
  diffPanelWidth: number
  toastMessage: string | null

  toggleSidebar: () => void
  toggleTerminal: () => void
  toggleDiffPanel: () => void
  openSettings: () => void
  closeSettings: () => void
  setActiveView: (view: 'chat' | 'skills') => void
  openSkillsView: () => void
  resizeDiffPanel: (delta: number) => void
  closeTerminal: () => void
  showToast: (message: string) => void
  clearToast: () => void
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useUIStore = create<UIState>((set, get) => ({
  settingsOpen: false,
  sidebarOpen: true,
  terminalOpen: false,
  activeView: 'chat',
  diffPanelOpen: false,
  diffPanelWidth: 600,
  toastMessage: null,

  toggleSidebar() {
    set({ sidebarOpen: !get().sidebarOpen })
  },

  toggleTerminal() {
    set({ terminalOpen: !get().terminalOpen })
  },

  toggleDiffPanel() {
    set({ diffPanelOpen: !get().diffPanelOpen })
  },

  openSettings() {
    set({ settingsOpen: true })
  },

  closeSettings() {
    set({ settingsOpen: false })
  },

  setActiveView(view) {
    set({ activeView: view })
  },

  openSkillsView() {
    set({ activeView: 'skills', diffPanelOpen: false })
  },

  resizeDiffPanel(delta) {
    const next = get().diffPanelWidth + delta
    set({ diffPanelWidth: Math.min(DIFF_PANEL_MAX, Math.max(DIFF_PANEL_MIN, next)) })
  },

  closeTerminal() {
    set({ terminalOpen: false })
  },

  showToast(message) {
    if (toastTimer) clearTimeout(toastTimer)
    set({ toastMessage: message })
    toastTimer = setTimeout(() => {
      toastTimer = null
      set({ toastMessage: null })
    }, 3500)
  },

  clearToast() {
    if (toastTimer) {
      clearTimeout(toastTimer)
      toastTimer = null
    }
    set({ toastMessage: null })
  },
}))

// Sync timer cleanup when toastMessage is cleared externally (e.g. direct setState in tests)
useUIStore.subscribe((state, prev) => {
  if (prev.toastMessage !== null && state.toastMessage === null && toastTimer) {
    clearTimeout(toastTimer)
    toastTimer = null
  }
})
