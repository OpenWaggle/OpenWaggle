import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useChat } from '@/features/chat/hooks'
import { takeDraftMaterialization } from '@/features/chat/state'
import { useProject } from '@/features/sessions/hooks'
import {
  MAX_PANEL_HEIGHT,
  MIN_PANEL_HEIGHT,
  TERMINAL_PANEL_DEFAULT_HEIGHT,
  type TerminalOwnerContext,
  terminalOwnerContext,
  terminalSidePanelLayoutKey,
  useTerminalStore,
} from '@/features/terminal'
import { cn } from '@/shared/lib/cn'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'
import { useUIStore } from '@/shell/ui-store'
import { useWorkspacePanelStore } from '@/shell/workspace-panel-store'
import { releaseOwnerHandoffAfterCommit } from './terminal-owner-handoff-release'
import { migrateTerminalOwner } from './workspace-terminal-owner-migration'

const TERMINAL_RESIZE_STEP_PX = 8
const TERMINAL_RESIZE_LARGE_STEP_PX = 40

const LazyTerminalPanel = lazy(() =>
  import('@/features/terminal/components').then((module) => ({
    default: module.TerminalPanel,
  })),
)

function isDraftOwnerMigration(previousOwner: TerminalOwnerContext, nextOwnerKey: string) {
  const previousOwnerKey = previousOwner.ownerKey
  const previousSidePanelKey = terminalSidePanelLayoutKey(previousOwnerKey)
  return (
    previousOwnerKey.startsWith('draft:') &&
    nextOwnerKey.length > 0 &&
    !nextOwnerKey.startsWith('draft:') &&
    (useTerminalStore.getState().groups[previousOwnerKey] !== undefined ||
      useTerminalStore.getState().groups[previousSidePanelKey] !== undefined ||
      useWorkspacePanelStore.getState().groups[previousOwnerKey] !== undefined) &&
    takeDraftMaterialization(previousOwner.defaultCwd, nextOwnerKey)
  )
}

function useDisplayTerminalOwner(owner: TerminalOwnerContext) {
  const [displayOwner, setDisplayOwner] = useState<TerminalOwnerContext>(owner)
  const currentOwnerRef = useRef(owner)
  const inFlightMigrations = useRef(new Map<string, TerminalOwnerContext>())
  const showToast = useUIStore((state) => state.showToast)

  useEffect(() => {
    currentOwnerRef.current = owner
  }, [owner])

  useEffect(() => {
    const previousOwnerKey = displayOwner.ownerKey
    const pendingSource = inFlightMigrations.current.get(owner.ownerKey)
    if (pendingSource !== undefined) {
      if (displayOwner.ownerKey !== pendingSource.ownerKey) setDisplayOwner(pendingSource)
      return
    }
    if (!isDraftOwnerMigration(displayOwner, owner.ownerKey)) {
      if (
        previousOwnerKey !== owner.ownerKey ||
        displayOwner.defaultCwd !== owner.defaultCwd ||
        displayOwner.defaultProvenance !== owner.defaultProvenance
      ) {
        setDisplayOwner({
          ownerKey: owner.ownerKey,
          defaultCwd: owner.defaultCwd,
          defaultProvenance: owner.defaultProvenance,
        })
      }
      return
    }

    inFlightMigrations.current.set(owner.ownerKey, displayOwner)
    void migrateTerminalOwner(previousOwnerKey, owner.ownerKey)
      .then((releaseEventHandoff) => {
        inFlightMigrations.current.delete(owner.ownerKey)
        if (currentOwnerRef.current.ownerKey === owner.ownerKey) {
          setDisplayOwner({
            ownerKey: owner.ownerKey,
            defaultCwd: owner.defaultCwd,
            defaultProvenance: owner.defaultProvenance,
          })
        }
        releaseOwnerHandoffAfterCommit(releaseEventHandoff)
      })
      .catch((error: unknown) => {
        inFlightMigrations.current.delete(owner.ownerKey)
        // Keep any unmoved draft tabs under their draft owner, not displayed as
        // the destination Session. A consumed receipt is not an automatic retry.
        if (currentOwnerRef.current.ownerKey === owner.ownerKey) {
          setDisplayOwner({
            ownerKey: owner.ownerKey,
            defaultCwd: owner.defaultCwd,
            defaultProvenance: owner.defaultProvenance,
          })
        }
        showToast(
          error instanceof Error
            ? error.message
            : 'Could not move draft terminals into the Session.',
          'error',
        )
      })
  }, [displayOwner, owner.defaultCwd, owner.defaultProvenance, owner.ownerKey, showToast])

  return displayOwner
}

function useTerminalResizeRail(ownerKey: string, terminalOpen: boolean) {
  const railRef = useRef<HTMLHRElement>(null)

  useEffect(() => {
    if (!terminalOpen) return
    const rail = railRef.current
    if (rail === null) return
    let startY = 0
    let startHeight = 0

    const currentHeight = () =>
      useTerminalStore.getState().groups[ownerKey]?.panelHeight ?? TERMINAL_PANEL_DEFAULT_HEIGHT
    const onPointerDown = (event: PointerEvent) => {
      startY = event.clientY
      startHeight = currentHeight()
      rail.setPointerCapture(event.pointerId)
    }
    const onPointerMove = (event: PointerEvent) => {
      if (!rail.hasPointerCapture(event.pointerId)) return
      useTerminalStore.getState().setPanelHeight(ownerKey, startHeight - (event.clientY - startY))
    }
    const onPointerUp = (event: PointerEvent) => rail.releasePointerCapture(event.pointerId)
    const onDoubleClick = () =>
      useTerminalStore.getState().setPanelHeight(ownerKey, TERMINAL_PANEL_DEFAULT_HEIGHT)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        useTerminalStore
          .getState()
          .setPanelHeight(ownerKey, event.key === 'Home' ? MIN_PANEL_HEIGHT : MAX_PANEL_HEIGHT)
        return
      }
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      event.preventDefault()
      const step = event.shiftKey ? TERMINAL_RESIZE_LARGE_STEP_PX : TERMINAL_RESIZE_STEP_PX
      const direction = event.key === 'ArrowUp' ? step : -step
      useTerminalStore.getState().setPanelHeight(ownerKey, currentHeight() + direction)
    }

    rail.addEventListener('pointerdown', onPointerDown)
    rail.addEventListener('pointermove', onPointerMove)
    rail.addEventListener('pointerup', onPointerUp)
    rail.addEventListener('dblclick', onDoubleClick)
    rail.addEventListener('keydown', onKeyDown)
    return () => {
      rail.removeEventListener('pointerdown', onPointerDown)
      rail.removeEventListener('pointermove', onPointerMove)
      rail.removeEventListener('pointerup', onPointerUp)
      rail.removeEventListener('dblclick', onDoubleClick)
      rail.removeEventListener('keydown', onKeyDown)
    }
  }, [ownerKey, terminalOpen])

  return railRef
}

/** Hosts the Session terminal panel while the main process owns its PTYs. */
export function WorkspaceTerminal() {
  const { activeSession } = useChat()
  const { projectPath } = useProject()
  const owner = terminalOwnerContext(activeSession, projectPath)
  const displayOwner = useDisplayTerminalOwner(owner)
  const group = useTerminalStore((state) => state.groups[displayOwner.ownerKey])
  const terminalOpen = group?.panelOpen ?? false
  const panelHeight = group?.panelHeight ?? TERMINAL_PANEL_DEFAULT_HEIGHT
  const railRef = useTerminalResizeRail(displayOwner.ownerKey, terminalOpen)

  const dockActiveTab = (tabId: string) => {
    useTerminalStore
      .getState()
      .moveTab(displayOwner.ownerKey, terminalSidePanelLayoutKey(displayOwner.ownerKey), tabId)
    useWorkspacePanelStore.getState().showTerminal(displayOwner.ownerKey)
  }

  return (
    <div
      className={cn('relative overflow-hidden', terminalOpen ? 'opacity-100' : 'h-0 opacity-0')}
      style={terminalOpen ? { height: panelHeight } : undefined}
      data-testid="workspace-terminal"
    >
      {terminalOpen && (
        <>
          <hr
            ref={railRef}
            data-terminal-resize-rail
            tabIndex={0}
            aria-label="Resize terminal panel"
            aria-orientation="horizontal"
            aria-valuemin={MIN_PANEL_HEIGHT}
            aria-valuemax={MAX_PANEL_HEIGHT}
            aria-valuenow={panelHeight}
            className="absolute inset-x-0 top-0 z-20 h-1 cursor-row-resize border-0 outline-none hover:bg-accent/30 focus-visible:bg-accent/40"
          />
          <PanelErrorBoundary name="Terminal">
            <Suspense fallback={null}>
              <LazyTerminalPanel
                ownerKey={displayOwner.ownerKey}
                defaultCwd={displayOwner.defaultCwd}
                defaultProvenance={displayOwner.defaultProvenance}
                onClose={() =>
                  useTerminalStore.getState().setPanelOpen(displayOwner.ownerKey, false)
                }
                onDockActiveTab={dockActiveTab}
              />
            </Suspense>
          </PanelErrorBoundary>
        </>
      )}
    </div>
  )
}
