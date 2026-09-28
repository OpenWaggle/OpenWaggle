import { type ReactNode, useEffect } from 'react'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import { RightSidebarLayout } from '@/shared/ui/RightSidebarLayout'
import { useActionPanelStore } from '../../state/action-panel-store'
import { ActionPanel } from './ActionPanel'

/** Mirrors the workspace side panel's sizing so every right sidebar behaves alike (ADR 0038). */
const ACTION_PANEL_SIZING = {
  defaultWidth: 520,
  minWidth: 320,
  maxWidth: 900,
  mainMinWidth: 420,
  sheetBreakpointPx: 980,
  storageKey: 'openwaggle:action-panel-width',
} as const

/**
 * Docks the guided action panel in the single right-sidebar slot. Opening it replaces the
 * current sidebar; closing it restores that sidebar. Another sidebar taking the slot closes the
 * panel and keeps its draft.
 */
export function ActionPanelLayout({ children }: { readonly children: ReactNode }) {
  const request = useActionPanelStore((state) => state.request)
  const claimed = useRightSidebarCoordinator((state) => state.activeClaim?.kind === 'action-panel')
  const open = request !== null && claimed
  useEffect(() => {
    if (request !== null && !claimed) useActionPanelStore.getState().forgetRequest()
  }, [claimed, request])
  return (
    <RightSidebarLayout
      open={open}
      sizing={ACTION_PANEL_SIZING}
      sidebar={request ? <ActionPanel request={request} /> : null}
      onOpenChange={(next) => {
        if (!next) useActionPanelStore.getState().closePanel()
      }}
    >
      {children}
    </RightSidebarLayout>
  )
}
