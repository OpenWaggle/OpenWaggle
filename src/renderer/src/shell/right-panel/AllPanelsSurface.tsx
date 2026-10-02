import { useNavigate } from '@tanstack/react-router'
import { PackageOpen, Pin, PinOff, RotateCcw, X } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import {
  hasRightPanelController,
  type RightPanelSurfaceId,
  showRightPanelSurface,
  toggleRightPanelSurface,
} from '@/shared/lib/right-panel-surfaces'
import { Button } from '@/shared/ui/Button'
import { RightPanelMaximizeButton } from '@/shared/ui/RightPanelMaximizeButton'
import { useUIStore } from '../ui-store'
import { useWorkspacePanelStore } from '../workspace-panel-store'
import { RightPanelSurfaceIcon } from './RightPanelSurfaceIcon'
import { useRightPanelRailStore } from './right-panel-rail-store'
import { OPEN_A_SESSION_FIRST } from './right-panel-shortcut-handlers'
import { type RightPanelSurfaceEntry, useRightPanelModel } from './useRightPanelModel'

function SurfaceRow(props: {
  readonly surface: RightPanelSurfaceEntry
  readonly noRoom: boolean
  readonly onPin: (id: RightPanelSurfaceId, pinned: boolean) => void
  readonly onShow: (id: RightPanelSurfaceId) => void
}) {
  const { surface } = props
  const unavailable = surface.disabledReason !== null
  const pinLabel = surface.pinned ? 'Remove from rail' : 'Add to rail'
  return (
    <li className="group flex items-center gap-1 rounded-md hover:bg-bg-hover">
      <Button
        type="button"
        variant="unstyled"
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-text-primary',
          unavailable && 'text-text-tertiary',
        )}
        title={surface.disabledReason ?? surface.description}
        aria-disabled={unavailable || undefined}
        onClick={() => props.onShow(surface.id)}
      >
        <RightPanelSurfaceIcon glyph={surface.glyph} title={surface.title} />
        <span className="min-w-0 flex-1 truncate">{surface.title}</span>
        {surface.isNew ? (
          <span className="rounded bg-accent/15 px-1.5 text-xs font-medium text-accent">New</span>
        ) : null}
        {surface.needsLabel ? (
          <span className="rounded border border-warning/40 px-1.5 text-xs text-warning">
            {surface.needsLabel}
          </span>
        ) : null}
        {surface.disabledReason !== null && surface.needsLabel === null ? (
          <span className="truncate text-xs text-text-tertiary">{surface.disabledReason}</span>
        ) : null}
        {props.noRoom ? <span className="text-xs text-text-tertiary">No room on rail</span> : null}
        {surface.shortcutLabel ? (
          <kbd className="rounded bg-bg-tertiary px-1.5 font-sans text-xs text-text-tertiary">
            {surface.shortcutLabel}
          </kbd>
        ) : null}
      </Button>
      {surface.needsLabel === null ? (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-pressed={surface.pinned}
          aria-label={`${pinLabel}: ${surface.title}`}
          title={pinLabel}
          className={cn('mr-1', surface.pinned && 'text-accent')}
          onClick={() => props.onPin(surface.id, !surface.pinned)}
        >
          {surface.pinned ? <Pin className="size-3.5" /> : <PinOff className="size-3.5" />}
        </Button>
      ) : null}
    </li>
  )
}

function groupedExtensions(surfaces: readonly RightPanelSurfaceEntry[]) {
  const groups = new Map<string, RightPanelSurfaceEntry[]>()
  for (const surface of surfaces) {
    const name = surface.extension?.extensionName ?? 'Extension'
    groups.set(name, [...(groups.get(name) ?? []), surface])
  }
  return [...groups.entries()]
}

/**
 * The All panels index: every surface with its shortcut, including ones kept off the rail, ones
 * without room and extension panels that cannot run yet (ADR 0043).
 */
export function AllPanelsSurface() {
  const navigate = useNavigate()
  const model = useRightPanelModel()
  const overflowing = useRightPanelRailStore((state) => state.overflowing)
  const setPinned = useRightPanelRailStore((state) => state.setPinned)
  const reset = useRightPanelRailStore((state) => state.reset)
  const showToast = useUIStore((state) => state.showToast)
  const showSurface = (id: RightPanelSurfaceId) => {
    if (hasRightPanelController()) showRightPanelSurface(id)
    else showToast(OPEN_A_SESSION_FIRST, 'error')
  }
  const listed = model.surfaces.filter((surface) => surface.id !== 'all-panels')
  const extensions = listed.filter((surface) => surface.group === 'Extensions')
  const row = (surface: RightPanelSurfaceEntry) => (
    <SurfaceRow
      key={surface.id}
      surface={surface}
      noRoom={surface.pinned && overflowing.includes(surface.id)}
      onPin={setPinned}
      onShow={showSurface}
    />
  )

  return (
    <section aria-labelledby="all-panels-heading" className="flex min-h-0 flex-1 flex-col bg-bg">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <h2
          id="all-panels-heading"
          tabIndex={-1}
          data-right-sidebar-focus-target="true"
          className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium text-text-primary outline-none"
        >
          All panels
        </h2>
        <RightPanelMaximizeButton />
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Close panel"
          title="Close panel"
          onClick={() => {
            // Off a chat page there is no Panel rail controller; the workspace panel still closes.
            if (hasRightPanelController()) toggleRightPanelSurface('all-panels')
            else useWorkspacePanelStore.getState().hidePanel(model.ownerKey)
          }}
        >
          <X className="size-3.5" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {(['Workspace', 'Session'] as const).map((group) => (
          <div key={group} className="mb-2">
            <h3 className="px-2 pt-2 pb-1 text-xs font-medium text-text-tertiary">{group}</h3>
            <ul className="space-y-px">
              {listed.filter((surface) => surface.group === group).map(row)}
            </ul>
          </div>
        ))}
        <div className="mb-2">
          <h3 className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-xs font-medium text-text-tertiary">
            <PackageOpen className="size-3" aria-hidden="true" />
            Extensions
          </h3>
          {extensions.length === 0 ? (
            <div className="mx-2 mt-1 rounded-md border border-dashed border-border p-3 text-xs text-text-tertiary">
              <p>Extensions can add their own panels here.</p>
              <Button
                type="button"
                variant="link"
                size="none"
                className="mt-2 text-xs"
                onClick={() =>
                  void navigate({ to: '/settings/$tab', params: { tab: 'extensions' } })
                }
              >
                Browse extensions
              </Button>
            </div>
          ) : (
            groupedExtensions(extensions).map(([name, surfaces]) => (
              <div key={name}>
                <h4 className="px-2 pt-1.5 pb-0.5 text-xs text-text-tertiary">{name}</h4>
                <ul className="space-y-px">{surfaces.map(row)}</ul>
              </div>
            ))
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-1 border-t border-border pt-2">
          <Button type="button" size="xs" variant="ghost" onClick={reset}>
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Reset rail
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => void navigate({ to: '/settings/$tab', params: { tab: 'extensions' } })}
          >
            <PackageOpen className="size-3.5" aria-hidden="true" />
            Manage extensions
          </Button>
        </div>
      </div>
    </section>
  )
}
