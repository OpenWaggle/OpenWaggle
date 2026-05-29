import { useRightSidebarResizeRail } from '@/shared/hooks/useRightSidebarResizeRail'
import { cn } from '@/shared/lib/cn'
import { Button } from './Button'
import { resizeRailStyle } from './right-sidebar-layout-sizing'
import type {
  ResizeRailActions,
  ResizeRailBounds,
  ResizeRailRefs,
  ResizeRailStateInput,
  WidthAcceptanceContext,
} from './right-sidebar-layout-types'

interface ResizeRailProps {
  readonly actions: ResizeRailActions
  readonly bounds: ResizeRailBounds
  readonly handles: ResizeRailRefs
  readonly state: ResizeRailStateInput
  readonly shouldAcceptWidth?: (context: WidthAcceptanceContext) => boolean
}

export function RightSidebarResizeRail({
  actions,
  bounds,
  handles,
  state,
  shouldAcceptWidth,
}: ResizeRailProps) {
  const resize = useRightSidebarResizeRail({
    actions,
    bounds,
    refs: handles,
    state,
    shouldAcceptWidth,
  })

  return (
    <Button
      variant="unstyled"
      aria-label="Resize right sidebar"
      className={cn(
        'absolute inset-y-0 z-20 hidden w-4 shrink-0 cursor-col-resize border-0 bg-transparent p-0 transition-[right,opacity] duration-200 ease-out sm:block',
        'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors',
        'hover:after:bg-accent/50 active:after:bg-accent/70',
        state.open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
      )}
      style={resizeRailStyle(state.open, state.width, bounds.mainMinWidth)}
      onClick={resize.handleClick}
      onLostPointerCapture={(event) => resize.cleanupResizeState(event.pointerId)}
      onPointerCancel={resize.endResize}
      onPointerDown={resize.handlePointerDown}
      onPointerMove={resize.handlePointerMove}
      onPointerUp={resize.endResize}
      tabIndex={-1}
      title="Drag to resize right sidebar"
    />
  )
}
