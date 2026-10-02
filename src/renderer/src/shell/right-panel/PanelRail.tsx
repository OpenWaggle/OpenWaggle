import { LayoutGrid } from 'lucide-react'
import { type KeyboardEvent, type MouseEvent, useEffect, useEffectEvent, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import type { RightPanelSurfaceId } from '@/shared/lib/right-panel-surfaces'
import { Button } from '@/shared/ui/Button'
import { PanelRailMenu, type PanelRailMenuTarget } from './PanelRailMenu'
import { RightPanelSurfaceIcon } from './RightPanelSurfaceIcon'
import type { RailMove } from './right-panel-rail-order'
import { useRightPanelRailStore } from './right-panel-rail-store'
import { usePanelRailDrag } from './usePanelRailDrag'
import type { RightPanelModel, RightPanelSurfaceEntry } from './useRightPanelModel'

/** One rail slot: a 32px icon button plus the 2px gap between slots. */
const RAIL_SLOT_PX = 34
/** All panels, its separator and the rail's vertical padding. */
const RAIL_FIXED_PX = RAIL_SLOT_PX + 9 + 12

interface PanelRailActions {
  readonly toggleSurface: (id: RightPanelSurfaceId) => void
  readonly showSurface: (id: RightPanelSurfaceId) => void
  readonly move: (id: RightPanelSurfaceId, move: RailMove) => void
  readonly unpin: (id: RightPanelSurfaceId) => void
  readonly reset: () => void
}

function surfaceTooltip(surface: RightPanelSurfaceEntry) {
  const parts = [surface.title]
  if (surface.extension !== null) parts.push(surface.extension.extensionName)
  if (surface.running) parts.push('running')
  const label = parts.join(' · ')
  const withShortcut = surface.shortcutLabel ? `${label} (${surface.shortcutLabel})` : label
  return surface.disabledReason ? `${withShortcut} — ${surface.disabledReason}` : withShortcut
}

function useRailCapacity() {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [capacity, setCapacity] = useState(Number.POSITIVE_INFINITY)
  useEffect(() => {
    if (element === null) return
    const measure = () => {
      const height = element.clientHeight
      if (height > 0) setCapacity(Math.max(1, Math.floor((height - RAIL_FIXED_PX) / RAIL_SLOT_PX)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return { capacity, measureRef: setElement }
}

interface RailButtonState {
  readonly active: boolean
  readonly dragging: boolean
  readonly dropEdge: 'before' | 'after' | null
  readonly badge?: string
}

interface RailButtonEvents {
  readonly onActivate: () => void
  readonly onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void
  readonly onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void
  readonly drag?: ReturnType<typeof usePanelRailDrag>['handlers']
}

function RailButton({
  surface,
  state,
  events,
}: {
  readonly surface: RightPanelSurfaceEntry
  readonly state: RailButtonState
  readonly events: RailButtonEvents
}) {
  const props = { ...state, ...events, dragHandlers: events.drag }
  const disabled = surface.disabledReason !== null
  return (
    <Button
      type="button"
      variant="unstyled"
      data-rail-surface={surface.id}
      data-active={props.active || undefined}
      aria-pressed={props.active}
      aria-disabled={disabled || undefined}
      aria-keyshortcuts={surface.id === 'all-panels' ? undefined : 'Alt+ArrowUp Alt+ArrowDown'}
      aria-label={surfaceTooltip(surface)}
      title={surfaceTooltip(surface)}
      className={cn(
        'no-drag relative grid size-8 shrink-0 cursor-default touch-none select-none place-items-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary',
        props.active &&
          'bg-bg-active text-text-primary before:absolute before:-right-1.5 before:inset-y-1.5 before:w-0.5 before:rounded-full before:bg-accent',
        disabled && 'opacity-40',
        props.dragging &&
          'cursor-grabbing bg-bg-active text-text-primary shadow-lg ring-1 ring-accent',
        props.dropEdge === 'before' &&
          'after:absolute after:inset-x-1 after:-top-0.5 after:h-0.5 after:rounded-full after:bg-accent',
        props.dropEdge === 'after' &&
          'after:absolute after:inset-x-1 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-accent',
      )}
      onClick={props.onActivate}
      onContextMenu={props.onContextMenu}
      onKeyDown={props.onKeyDown}
      onPointerDown={(event) => props.dragHandlers?.onPointerDown(event, surface.id)}
      onPointerMove={props.dragHandlers?.onPointerMove}
      onPointerUp={props.dragHandlers?.onPointerUp}
      onPointerCancel={props.dragHandlers?.onPointerCancel}
    >
      <RightPanelSurfaceIcon glyph={surface.glyph} title={surface.title} />
      {surface.isNew ? (
        <span
          aria-hidden="true"
          className="absolute top-1 right-1 size-1.5 rounded-full bg-accent ring-2 ring-bg-secondary"
        />
      ) : null}
      {surface.running ? (
        <span
          aria-hidden="true"
          className="absolute right-1 bottom-1 size-1.5 rounded-full bg-success ring-2 ring-bg-secondary"
        />
      ) : null}
      {props.badge ? (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 bottom-0 rounded-full bg-bg-hover px-1 text-xs leading-none text-text-secondary ring-1 ring-border"
        >
          {props.badge}
        </span>
      ) : null}
    </Button>
  )
}

/** The Panel rail: All panels first, then the user's surfaces in their order (ADR 0043). */
export function PanelRail(props: {
  readonly model: RightPanelModel
  readonly actions: PanelRailActions
}) {
  const { model, actions } = props
  const { capacity, measureRef } = useRailCapacity()
  const [menu, setMenu] = useState<PanelRailMenuTarget | null>(null)
  const railIds = model.railSurfaces.map((surface) => surface.id)
  const drag = usePanelRailDrag(railIds, actions.move)
  const fits = model.railSurfaces.slice(0, capacity)
  const overflow = model.railSurfaces.length - fits.length
  const allPanels = model.surfaces.find((surface) => surface.id === 'all-panels')
  const anyNew = model.surfaces.some((surface) => surface.isNew)
  const highlight = model.shown.open ? model.shown.highlight : null
  const overflowIds = model.railSurfaces.slice(fits.length).map((surface) => surface.id)
  const overflowKey = overflowIds.join('\n')
  // The key keeps the effect from re-running for an equal list rebuilt on every render.
  const publishOverflow = useEffectEvent((_key: string) =>
    useRightPanelRailStore.getState().setOverflowing(overflowIds),
  )
  useEffect(() => publishOverflow(overflowKey), [overflowKey])

  function activate(id: RightPanelSurfaceId) {
    if (drag.consumeClick()) return
    actions.toggleSurface(id)
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, id: RightPanelSurfaceId) {
    if (!event.altKey || event.metaKey || event.ctrlKey) return
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    actions.move(id, { type: event.key === 'ArrowUp' ? 'up' : 'down' })
  }

  function openMenu(event: MouseEvent<HTMLButtonElement>, surface: RightPanelSurfaceEntry) {
    event.preventDefault()
    drag.cancel()
    const index = railIds.indexOf(surface.id)
    setMenu({
      id: surface.id,
      title: surface.title,
      x: event.clientX,
      y: event.clientY,
      canMoveUp: index > 0,
      canMoveDown: index >= 0 && index < railIds.length - 1,
    })
  }

  return (
    <nav
      ref={measureRef}
      aria-label="Panels"
      data-panel-rail="true"
      className={cn(
        'flex h-full w-11 shrink-0 flex-col items-center gap-0.5 overflow-hidden border-l border-border bg-bg-secondary py-1.5',
        drag.dragging !== null && 'cursor-grabbing',
      )}
    >
      {allPanels ? (
        <RailButton
          surface={{ ...allPanels, isNew: anyNew }}
          state={{
            active: highlight === 'all-panels',
            dragging: false,
            dropEdge: null,
            ...(overflow > 0 ? { badge: `+${String(overflow)}` } : {}),
          }}
          events={{ onActivate: () => activate('all-panels') }}
        />
      ) : (
        <LayoutGrid className="size-4" />
      )}
      <span aria-hidden="true" className="my-1 h-px w-5 shrink-0 bg-border" />
      {fits.map((surface) => (
        <RailButton
          key={surface.id}
          surface={surface}
          state={{
            active: highlight === surface.id,
            dragging: drag.dragging === surface.id,
            dropEdge:
              drag.drop?.target === surface.id ? (drag.drop.after ? 'after' : 'before') : null,
          }}
          events={{
            onActivate: () => activate(surface.id),
            onContextMenu: (event) => openMenu(event, surface),
            onKeyDown: (event) => onKeyDown(event, surface.id),
            drag: drag.handlers,
          }}
        />
      ))}
      {menu ? (
        <PanelRailMenu
          target={menu}
          onClose={() => setMenu(null)}
          onMove={(id, direction) => actions.move(id, { type: direction })}
          onUnpin={actions.unpin}
          onShowAllPanels={() => actions.showSurface('all-panels')}
          onReset={actions.reset}
        />
      ) : null}
    </nav>
  )
}
