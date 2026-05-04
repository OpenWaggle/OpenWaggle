import type { AgentErrorInfo } from '@shared/types/errors'
import { create } from 'zustand'

const DELAY_MS = 3500
const FEEDBACK_COOLDOWN_MS = 60_000

export const DIFF_PANEL_MIN = 360
export const DIFF_PANEL_MAX = 900
export const CHAT_MIN_WIDTH = 420

export type RightSidebarPanel = 'diff' | 'session-tree'

export interface ToastData {
  message: string
  /** Visual variant — defaults to 'neutral'. */
  variant?: 'neutral' | 'success'
  /** When set, the toast persists until manually dismissed. */
  persistent?: boolean
  /** Optional action shown as a clickable label. Supports a URL or an onClick callback. */
  action?: { label: string; url?: string; onClick?: () => void }
}

export type SettingsTab =
  | 'general'
  | 'configuration'
  | 'waggle'
  | 'personalization'
  | 'git'
  | 'environments'
  | 'worktrees'
  | 'archived'
  | 'connections'

interface UIState {
  sidebarOpen: boolean
  terminalOpen: boolean
  activeView: 'chat' | 'skills' | 'settings'
  activeSettingsTab: SettingsTab
  diffRefreshKey: number
  toastMessage: string | null
  toastData: ToastData | null
  commandPaletteOpen: boolean
  feedbackModalOpen: boolean
  feedbackErrorContext: AgentErrorInfo | null
  feedbackCooldownActive: boolean
  lastRightSidebarPanel: RightSidebarPanel

  toggleSidebar: () => void
  toggleTerminal: () => void
  setActiveView: (view: 'chat' | 'skills' | 'settings') => void
  setActiveSettingsTab: (tab: SettingsTab) => void
  bumpDiffRefreshKey: () => void
  closeTerminal: () => void
  showToast: (message: string) => void
  showPersistentToast: (data: ToastData) => void
  clearToast: () => void
  openCommandPalette: () => void
  closeCommandPalette: () => void
  toggleCommandPalette: () => void
  openFeedbackModal: (errorContext?: AgentErrorInfo) => void
  closeFeedbackModal: () => void
  startFeedbackCooldown: () => void
  setLastRightSidebarPanel: (panel: RightSidebarPanel) => void
}

let toastTimer: ReturnType<typeof setTimeout> | null = null
let feedbackCooldownTimer: ReturnType<typeof setTimeout> | null = null

export const useUIStore = create<UIState>((set, get) => ({
  sidebarOpen: true,
  terminalOpen: false,
  activeView: 'chat',
  activeSettingsTab: 'general',
  diffRefreshKey: 0,
  toastMessage: null,
  toastData: null,
  commandPaletteOpen: false,
  feedbackModalOpen: false,
  feedbackErrorContext: null,
  feedbackCooldownActive: false,
  lastRightSidebarPanel: 'diff',

  toggleSidebar() {
    set({ sidebarOpen: !get().sidebarOpen })
  },

  toggleTerminal() {
    set({ terminalOpen: !get().terminalOpen })
  },

  setActiveView(view) {
    set({ activeView: view })
  },

  setActiveSettingsTab(tab) {
    set({ activeSettingsTab: tab })
  },

  bumpDiffRefreshKey() {
    set((state) => ({ diffRefreshKey: state.diffRefreshKey + 1 }))
  },

  closeTerminal() {
    set({ terminalOpen: false })
  },

  showToast(message) {
    if (toastTimer) clearTimeout(toastTimer)
    set({ toastMessage: message, toastData: { message } })
    toastTimer = setTimeout(() => {
      toastTimer = null
      set({ toastMessage: null, toastData: null })
    }, DELAY_MS)
  },

  showPersistentToast(data) {
    if (toastTimer) {
      clearTimeout(toastTimer)
      toastTimer = null
    }
    set({ toastMessage: data.message, toastData: data })
  },

  clearToast() {
    if (toastTimer) {
      clearTimeout(toastTimer)
      toastTimer = null
    }
    set({ toastMessage: null, toastData: null })
  },

  openCommandPalette() {
    set({ commandPaletteOpen: true })
  },

  closeCommandPalette() {
    set({ commandPaletteOpen: false })
  },

  toggleCommandPalette() {
    set({ commandPaletteOpen: !get().commandPaletteOpen })
  },

  openFeedbackModal(errorContext) {
    set({ feedbackModalOpen: true, feedbackErrorContext: errorContext ?? null })
  },

  closeFeedbackModal() {
    set({ feedbackModalOpen: false, feedbackErrorContext: null })
  },

  startFeedbackCooldown() {
    if (feedbackCooldownTimer) clearTimeout(feedbackCooldownTimer)
    set({ feedbackCooldownActive: true })
    feedbackCooldownTimer = setTimeout(() => {
      feedbackCooldownTimer = null
      set({ feedbackCooldownActive: false })
    }, FEEDBACK_COOLDOWN_MS)
  },

  setLastRightSidebarPanel(panel) {
    set({ lastRightSidebarPanel: panel })
  },
}))

// Sync timer cleanup when toastMessage is cleared externally (e.g. direct setState in tests)
useUIStore.subscribe((state, prev) => {
  if (prev.toastMessage !== null && state.toastMessage === null && toastTimer) {
    clearTimeout(toastTimer)
    toastTimer = null
  }
})
