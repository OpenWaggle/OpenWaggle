import { ArrowDown, ArrowUp, Check, LayoutGrid, PinOff, RotateCcw } from 'lucide-react'
import { type ReactNode, useRef } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { useMenuKeyboard } from '@/shared/hooks/useMenuKeyboard'
import type { RightPanelSurfaceId } from '@/shared/lib/right-panel-surfaces'
import { Button } from '@/shared/ui/Button'
import { ContextMenu } from '@/shared/ui/ContextMenu'
import { useUIStore } from '../ui-store'

export interface PanelRailMenuTarget {
  readonly id: RightPanelSurfaceId
  readonly title: string
  readonly x: number
  readonly y: number
  readonly canMoveUp: boolean
  readonly canMoveDown: boolean
}

function MenuItem(props: {
  readonly children: ReactNode
  readonly icon: ReactNode
  readonly disabled?: boolean
  readonly checked?: boolean
  readonly trailing?: string
  readonly onSelect: () => void
}) {
  return (
    <Button
      type="button"
      role={props.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={props.checked}
      tabIndex={-1}
      variant="unstyled"
      disabled={props.disabled}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-default disabled:opacity-40"
      onClick={props.onSelect}
    >
      <span className="grid size-3.5 place-items-center">{props.icon}</span>
      <span className="min-w-0 flex-1">{props.children}</span>
      {props.trailing ? <span className="text-text-tertiary">{props.trailing}</span> : null}
    </Button>
  )
}

/** The rail's right-click menu: reorder, unpin, the rail-visibility preference and reset. */
export function PanelRailMenu(props: {
  readonly target: PanelRailMenuTarget
  readonly onClose: () => void
  readonly onMove: (id: RightPanelSurfaceId, direction: 'up' | 'down') => void
  readonly onUnpin: (id: RightPanelSurfaceId) => void
  readonly onShowAllPanels: () => void
  readonly onReset: () => void
}) {
  const { target } = props
  const menuRef = useRef<HTMLDivElement>(null)
  const railVisible = usePreferencesStore((state) => state.settings.rightPanelRailVisibleWhenClosed)
  const setRailVisible = usePreferencesStore((state) => state.setRightPanelRailVisibleWhenClosed)
  const showToast = useUIStore((state) => state.showToast)
  const toggleRailVisible = () => {
    void setRailVisible(!railVisible).catch((error: unknown) => {
      showToast(
        error instanceof Error ? error.message : 'Could not save the right panel setting.',
        'error',
      )
    })
  }
  const handleKeyDown = useMenuKeyboard({
    enabled: true,
    isOpen: true,
    panelRef: menuRef,
    onClose: props.onClose,
  })
  const select = (action: () => void) => () => {
    props.onClose()
    action()
  }

  return (
    <ContextMenu open onClose={props.onClose} position={{ x: target.x, y: target.y }}>
      <div
        ref={menuRef}
        role="menu"
        aria-label={`${target.title} options`}
        onKeyDown={handleKeyDown}
        className="min-w-56"
      >
        <MenuItem
          icon={<ArrowUp className="size-3.5" />}
          trailing="⌥↑"
          disabled={!target.canMoveUp}
          onSelect={select(() => props.onMove(target.id, 'up'))}
        >
          Move up
        </MenuItem>
        <MenuItem
          icon={<ArrowDown className="size-3.5" />}
          trailing="⌥↓"
          disabled={!target.canMoveDown}
          onSelect={select(() => props.onMove(target.id, 'down'))}
        >
          Move down
        </MenuItem>
        <MenuItem
          icon={<PinOff className="size-3.5" />}
          onSelect={select(() => props.onUnpin(target.id))}
        >
          Remove from rail
        </MenuItem>
        <hr className="my-1 border-border" />
        <MenuItem
          icon={railVisible ? <Check className="size-3.5" /> : null}
          checked={railVisible}
          onSelect={select(toggleRailVisible)}
        >
          Keep rail visible when panel is closed
        </MenuItem>
        <hr className="my-1 border-border" />
        <MenuItem
          icon={<LayoutGrid className="size-3.5" />}
          onSelect={select(props.onShowAllPanels)}
        >
          All panels
        </MenuItem>
        <MenuItem icon={<RotateCcw className="size-3.5" />} onSelect={select(props.onReset)}>
          Reset rail
        </MenuItem>
      </div>
    </ContextMenu>
  )
}
