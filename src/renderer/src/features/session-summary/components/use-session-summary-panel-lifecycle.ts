import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useEscapeHotkey } from '@/shared/hooks/useEscapeHotkey'
import {
  isSessionSummaryPanelVisible,
  type SessionSummaryPanelState,
  useSessionSummaryUIStore,
} from '../state/session-summary-ui-store'
import type { SessionSummaryHubInput } from './session-summary-hub-types'

const SUMMARY_STORAGE_PREFIX = 'openwaggle:session-summary'

function readExpanded(sessionId: string, key: string, fallback: boolean) {
  try {
    const stored = localStorage.getItem(`${SUMMARY_STORAGE_PREFIX}:${sessionId}:${key}`)
    return stored === null ? fallback : stored === 'true'
  } catch {
    return fallback
  }
}

export function usePersistedSummaryDisclosure(sessionId: string, key: string, fallback: boolean) {
  const [expanded, setExpanded] = useState(() => readExpanded(sessionId, key, fallback))
  const update = (next: boolean) => {
    setExpanded(next)
    try {
      localStorage.setItem(`${SUMMARY_STORAGE_PREFIX}:${sessionId}:${key}`, String(next))
    } catch {
      // The in-memory disclosure remains usable when storage is unavailable.
    }
  }
  return { expanded, setExpanded: update }
}

function useSyncSessionSummaryPanel(input: SessionSummaryHubInput, sessionId: string) {
  const syncPanel = useSessionSummaryUIStore((state) => state.syncPanel)
  const { session, messageCount, autoHidden, rightSidebarOpen } = input
  useEffect(() => {
    if (!session) return
    syncPanel(sessionId, {
      available: messageCount > 0,
      autoHidden,
      rightSidebarOpen,
    })
  }, [autoHidden, messageCount, rightSidebarOpen, session, sessionId, syncPanel])
}

function resolvePanelVisibility(
  input: SessionSummaryHubInput,
  panel: SessionSummaryPanelState | undefined,
  sessionId: string,
) {
  if (!panel) {
    return (
      input.messageCount > 0 &&
      readExpanded(sessionId, 'panel', true) &&
      !input.autoHidden &&
      !input.rightSidebarOpen
    )
  }
  return isSessionSummaryPanelVisible(panel, {
    available: input.messageCount > 0,
    autoHidden: input.autoHidden,
    rightSidebarOpen: input.rightSidebarOpen,
  })
}

function useRestoreFocusWhenPanelHides(panelId: string, panelVisible: boolean) {
  const panelHadFocus = useRef(false)

  useLayoutEffect(() => {
    if (!panelVisible) return
    const panel = document.getElementById(panelId)
    if (!panel) return

    panelHadFocus.current = panel.contains(document.activeElement)
    const rememberPanelFocus = () => {
      panelHadFocus.current = true
    }
    panel.addEventListener('focusin', rememberPanelFocus)

    return () => {
      panel.removeEventListener('focusin', rememberPanelFocus)
      const activeElement = document.activeElement
      const focusNeedsRestoring =
        panelHadFocus.current &&
        (!activeElement || activeElement === document.body || panel.contains(activeElement))
      panelHadFocus.current = false
      if (!focusNeedsRestoring) return
      queueMicrotask(() => document.getElementById(`${panelId}-toggle`)?.focus())
    }
  }, [panelId, panelVisible])
}

function useDismissTransientPanel(input: {
  readonly panelId: string
  readonly sessionId: string
  readonly transient: boolean
}) {
  const dismissTransientPanel = useSessionSummaryUIStore((state) => state.dismissTransientPanel)

  useEscapeHotkey(() => dismissTransientPanel(input.sessionId), {
    enabled: input.transient,
    // Native modal dialogs own their Escape default. Cancelling it here would hide the
    // background Summary but leave the foreground image viewer or Git dialog open.
    shouldHandle: (event) =>
      !(event.target instanceof Element && event.target.closest('dialog[open]')),
  })

  useEffect(() => {
    if (!input.transient) return

    const dismissOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (target instanceof Element && target.closest('dialog[open]')) return
      const panel = document.getElementById(input.panelId)
      const toggle = document.getElementById(`${input.panelId}-toggle`)
      if (panel?.contains(target) || toggle?.contains(target)) return
      dismissTransientPanel(input.sessionId)
    }

    document.addEventListener('pointerdown', dismissOnOutsidePointer)
    return () => {
      document.removeEventListener('pointerdown', dismissOnOutsidePointer)
    }
  }, [dismissTransientPanel, input.panelId, input.sessionId, input.transient])
}

export function useSessionSummaryPanelLifecycle(input: SessionSummaryHubInput, sessionId: string) {
  const panelId = `session-summary-${sessionId}`
  const panelState = useSessionSummaryUIStore((state) => state.panels[sessionId])
  useSyncSessionSummaryPanel(input, sessionId)
  const visible = resolvePanelVisibility(input, panelState, sessionId)
  const transient = Boolean(visible && input.autoHidden && panelState?.forcedOpen)
  useRestoreFocusWhenPanelHides(panelId, visible)
  useDismissTransientPanel({ panelId, sessionId, transient })
  return { id: panelId, transient, visible }
}
