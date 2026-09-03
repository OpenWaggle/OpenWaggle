import { lazy, Suspense, useEffect, useRef } from 'react'
import { TERMINAL_PANEL_DEFAULT_HEIGHT, useTerminalStore } from '@/features/terminal'
import { cn } from '@/shared/lib/cn'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'
import { useUIStore } from '@/shell/ui-store'

const LazyTerminalPanel = lazy(() =>
  import('@/features/terminal/components').then((module) => ({
    default: module.TerminalPanel,
  })),
)

/**
 * Hosts the Session terminal panel: terminals belong to the active session's
 * Working path (ADR 0030), and the shell keeps running while the panel is
 * hidden — only the viewport is unmounted.
 */
export function WorkspaceTerminal() {
  const terminalOpen = useUIStore((s) => s.terminalOpen)
  const closeTerminal = useUIStore((s) => s.closeTerminal)
  const panelHeight = useTerminalStore((s) => s.panelHeight)
  const railRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // The rail mounts only when the panel opens, so rewire on that change —
    // attaching once at host mount would bind to a rail that does not exist.
    if (!terminalOpen) return
    const rail = railRef.current
    if (rail === null) return
    let startY = 0
    let startHeight = 0

    const onPointerDown = (event: PointerEvent) => {
      startY = event.clientY
      startHeight = useTerminalStore.getState().panelHeight
      rail.setPointerCapture(event.pointerId)
    }
    const onPointerMove = (event: PointerEvent) => {
      if (!rail.hasPointerCapture(event.pointerId)) return
      useTerminalStore.getState().setPanelHeight(startHeight - (event.clientY - startY))
    }
    const onPointerUp = (event: PointerEvent) => {
      rail.releasePointerCapture(event.pointerId)
    }
    const onDoubleClick = () => {
      useTerminalStore.getState().setPanelHeight(TERMINAL_PANEL_DEFAULT_HEIGHT)
    }

    rail.addEventListener('pointerdown', onPointerDown)
    rail.addEventListener('pointermove', onPointerMove)
    rail.addEventListener('pointerup', onPointerUp)
    rail.addEventListener('dblclick', onDoubleClick)
    return () => {
      rail.removeEventListener('pointerdown', onPointerDown)
      rail.removeEventListener('pointermove', onPointerMove)
      rail.removeEventListener('pointerup', onPointerUp)
      rail.removeEventListener('dblclick', onDoubleClick)
    }
  }, [terminalOpen])

  return (
    <div
      className={cn(
        'relative overflow-hidden transition-[height] duration-200 ease-out',
        terminalOpen ? 'opacity-100' : 'h-0 opacity-0',
      )}
      style={terminalOpen ? { height: panelHeight } : undefined}
      data-testid="workspace-terminal"
    >
      {terminalOpen && (
        <>
          <div
            ref={railRef}
            data-terminal-resize-rail
            className="absolute inset-x-0 top-0 z-20 h-1 cursor-row-resize hover:bg-accent/30"
          />
          <PanelErrorBoundary name="Terminal">
            <Suspense fallback={null}>
              <LazyTerminalPanel onClose={closeTerminal} />
            </Suspense>
          </PanelErrorBoundary>
        </>
      )}
    </div>
  )
}
