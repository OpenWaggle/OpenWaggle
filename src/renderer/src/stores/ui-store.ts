import type { AgentErrorInfo } from '@shared/types/errors'
import { create } from 'zustand'

const DIFF_PANEL_WIDTH = 600
const DELAY_MS = 3500
const FEEDBACK_COOLDOWN_MS = 60_000

export const DIFF_PANEL_MIN = 360
export const DIFF_PANEL_MAX = 900
export const CHAT_MIN_WIDTH = 420

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

export type InspectorPanel = 'none' | 'diff' | 'context'

interface UIState {
  settingsOpen: boolean
  sidebarOpen: boolean
  terminalOpen: boolean
  activeView: 'chat' | 'skills' | 'mcps' | 'settings'
  activeSettingsTab: SettingsTab
  activeInspector: InspectorPanel
  diffPanelOpen: boolean
  diffPanelWidth: number
  diffRefreshKey: number
  toastMessage: string | null
  toastData: ToastData | null
  commandPaletteOpen: boolean
  feedbackModalOpen: boolean
  feedbackErrorContext: AgentErrorInfo | null
  feedbackCooldownActive: boolean

  toggleSidebar: () => void
  toggleTerminal: () => void
  toggleDiffPanel: () => void
  toggleInspector: (panel: 'diff' | 'context') => void
  setActiveInspector: (panel: InspectorPanel) => void
  openSettings: (tab?: SettingsTab) => void
  closeSettings: () => void
  setActiveView: (view: 'chat' | 'skills' | 'mcps' | 'settings') => void
  setActiveSettingsTab: (tab: SettingsTab) => void
  openSkillsView: () => void
  openMcpsView: () => void
  resizeDiffPanel: (delta: number) => void
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
}

let toastTimer: ReturnType<typeof setTimeout> | null = null
let feedbackCooldownTimer: ReturnType<typeof setTimeout> | null = null

export const useUIStore = create<UIState>((set, get) => ({
  settingsOpen: false,
  sidebarOpen: true,
  terminalOpen: false,
  activeView: 'chat',
  activeSettingsTab: 'general',
  activeInspector: 'none',
  diffPanelOpen: false,
  diffPanelWidth: DIFF_PANEL_WIDTH,
  diffRefreshKey: 0,
  toastMessage: null,
  toastData: null,
  commandPaletteOpen: false,
  feedbackModalOpen: false,
  feedbackErrorContext: null,
  feedbackCooldownActive: false,

  toggleSidebar() {
    set({ sidebarOpen: !get().sidebarOpen })
  },

  toggleTerminal() {
    set({ terminalOpen: !get().terminalOpen })
  },

  toggleDiffPanel() {
    const next = get().activeInspector === 'diff' ? 'none' : 'diff'
    set({ activeInspector: next, diffPanelOpen: next === 'diff' })
  },

  toggleInspector(panel) {
    const next = get().activeInspector === panel ? 'none' : panel
    set({ activeInspector: next, diffPanelOpen: next === 'diff' })
  },

  setActiveInspector(panel) {
    set({ activeInspector: panel, diffPanelOpen: panel === 'diff' })
  },

  openSettings(tab) {
    set({
      activeView: 'settings',
      activeSettingsTab: tab ?? 'general',
      settingsOpen: true,
      activeInspector: 'none',
      diffPanelOpen: false,
    })
  },

  closeSettings() {
    set({ activeView: 'chat', settingsOpen: false })
  },

  setActiveView(view) {
    set({ activeView: view })
  },

  setActiveSettingsTab(tab) {
    set({ activeSettingsTab: tab })
  },

  openSkillsView() {
    set({ activeView: 'skills', activeInspector: 'none', diffPanelOpen: false })
  },

  openMcpsView() {
    set({ activeView: 'mcps', activeInspector: 'none', diffPanelOpen: false })
  },

  resizeDiffPanel(delta) {
    const next = get().diffPanelWidth + delta
    set({ diffPanelWidth: Math.min(DIFF_PANEL_MAX, Math.max(DIFF_PANEL_MIN, next)) })
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
}))

// Sync timer cleanup when toastMessage is cleared externally (e.g. direct setState in tests)
useUIStore.subscribe((state, prev) => {
  if (prev.toastMessage !== null && state.toastMessage === null && toastTimer) {
    clearTimeout(toastTimer)
    toastTimer = null
  }
})
