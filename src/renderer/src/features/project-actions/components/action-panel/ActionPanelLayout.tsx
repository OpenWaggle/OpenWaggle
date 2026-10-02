import { lazy, type ReactNode, Suspense, useEffect } from 'react'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import { RightSidebarLayout } from '@/shared/ui/RightSidebarLayout'
import { RIGHT_PANEL_SIZING } from '@/shared/ui/right-sidebar-sizing-presets'
import { useActionPanelStore } from '../../state/action-panel-store'

// The guided editor only renders once a panel request is open, so keep it out of the eager
// shell graph (scripts/check-syntax-bundle.ts enforces the initial renderer budget).
const LazyActionPanel = lazy(() =>
  import('./ActionPanel').then((module) => ({ default: module.ActionPanel })),
)

/** The Right panel's shared width, so every right sidebar behaves alike (ADR 0038, ADR 0043). */
const ACTION_PANEL_SIZING = RIGHT_PANEL_SIZING

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
      sidebar={
        request ? (
          <Suspense fallback={null}>
            <LazyActionPanel request={request} />
          </Suspense>
        ) : null
      }
      onOpenChange={(next) => {
        if (!next) useActionPanelStore.getState().closePanel()
      }}
    >
      {children}
    </RightSidebarLayout>
  )
}
