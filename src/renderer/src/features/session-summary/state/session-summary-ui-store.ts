import { create } from 'zustand'

const PANEL_STORAGE_PREFIX = 'openwaggle:session-summary'

export interface SessionSummaryPanelContext {
  readonly available: boolean
  readonly autoHidden: boolean
  readonly rightSidebarOpen: boolean
}

export interface SessionSummaryPanelState extends SessionSummaryPanelContext {
  readonly expanded: boolean
  readonly forcedOpen: boolean
}

interface SessionSummaryUIState {
  readonly panels: Readonly<Record<string, SessionSummaryPanelState>>
  readonly toggleFocusTargetSessionId: string | null
  readonly syncPanel: (sessionId: string, context: SessionSummaryPanelContext) => void
  readonly closePanel: (sessionId: string) => void
  readonly dismissTransientPanel: (sessionId: string) => void
  readonly togglePanel: (sessionId: string) => void
  readonly requestToggleFocus: (sessionId: string) => void
  readonly clearToggleFocus: (sessionId: string) => void
}

function panelStorageKey(sessionId: string) {
  return `${PANEL_STORAGE_PREFIX}:${sessionId}:panel`
}

function readExpanded(sessionId: string) {
  if (typeof localStorage === 'undefined') return true
  try {
    const stored = localStorage.getItem(panelStorageKey(sessionId))
    return stored === null ? true : stored === 'true'
  } catch {
    return true
  }
}

function persistExpanded(sessionId: string, expanded: boolean) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(panelStorageKey(sessionId), String(expanded))
  } catch {
    // Persistence is optional. The in-memory preference still updates below.
  }
}

function createPanelState(
  sessionId: string,
  context: SessionSummaryPanelContext,
): SessionSummaryPanelState {
  return {
    ...context,
    expanded: readExpanded(sessionId),
    forcedOpen: false,
  }
}

function sameContext(current: SessionSummaryPanelState, context: SessionSummaryPanelContext) {
  return (
    current.available === context.available &&
    current.autoHidden === context.autoHidden &&
    current.rightSidebarOpen === context.rightSidebarOpen
  )
}

export function isSessionSummaryPanelVisible(
  panel: SessionSummaryPanelState | undefined,
  currentContext: SessionSummaryPanelContext | undefined = panel,
) {
  return Boolean(
    panel &&
      currentContext?.available &&
      !currentContext.rightSidebarOpen &&
      (currentContext.autoHidden ? panel.forcedOpen : panel.expanded),
  )
}

export const useSessionSummaryUIStore = create<SessionSummaryUIState>((set, get) => ({
  panels: {},
  toggleFocusTargetSessionId: null,

  requestToggleFocus(sessionId) {
    set({ toggleFocusTargetSessionId: sessionId })
  },

  clearToggleFocus(sessionId) {
    set((state) =>
      state.toggleFocusTargetSessionId === sessionId ? { toggleFocusTargetSessionId: null } : state,
    )
  },

  syncPanel(sessionId, context) {
    set((state) => {
      const current = state.panels[sessionId]
      if (!current) {
        return { panels: { ...state.panels, [sessionId]: createPanelState(sessionId, context) } }
      }
      if (sameContext(current, context)) return state
      return {
        panels: {
          ...state.panels,
          [sessionId]: {
            ...current,
            ...context,
            forcedOpen:
              context.available && context.autoHidden && current.autoHidden === context.autoHidden
                ? current.forcedOpen
                : false,
          },
        },
      }
    })
  },

  closePanel(sessionId) {
    const current = get().panels[sessionId]
    if (!current) return
    persistExpanded(sessionId, false)
    set((state) => ({
      panels: {
        ...state.panels,
        [sessionId]: { ...current, expanded: false, forcedOpen: false },
      },
    }))
  },

  dismissTransientPanel(sessionId) {
    const current = get().panels[sessionId]
    if (!current?.forcedOpen) return
    set((state) => ({
      panels: {
        ...state.panels,
        [sessionId]: { ...current, forcedOpen: false },
      },
    }))
  },

  togglePanel(sessionId) {
    const current = get().panels[sessionId]
    if (!current || current.rightSidebarOpen) return
    if (current.autoHidden) {
      set((state) => ({
        panels: {
          ...state.panels,
          [sessionId]: { ...current, forcedOpen: !current.forcedOpen },
        },
      }))
      return
    }
    if (current.expanded) {
      get().closePanel(sessionId)
      return
    }
    persistExpanded(sessionId, true)
    set((state) => ({
      panels: {
        ...state.panels,
        [sessionId]: {
          ...current,
          expanded: true,
          forcedOpen: false,
        },
      },
    }))
  },
}))
