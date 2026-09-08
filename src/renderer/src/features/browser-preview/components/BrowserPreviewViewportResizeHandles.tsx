import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import type { BrowserPreviewDeviceLayout } from '../lib/browser-preview-device-layout'
import { BROWSER_PREVIEW_VIEWPORT_RESIZE_RAIL_SIZE } from '../lib/browser-preview-device-layout'
import type { BrowserPreviewViewportResizeDirection } from '../lib/browser-preview-viewport-actions'

interface BrowserPreviewViewportResizeHandlers {
  readonly onKeyDown: (
    direction: BrowserPreviewViewportResizeDirection,
    event: KeyboardEvent<HTMLButtonElement>,
  ) => void
  readonly onPointerDown: (
    direction: BrowserPreviewViewportResizeDirection,
    event: PointerEvent<HTMLButtonElement>,
  ) => void
}

interface BrowserPreviewViewportResizeHandlesProps {
  readonly activeDirection: BrowserPreviewViewportResizeDirection | null
  readonly handlers: BrowserPreviewViewportResizeHandlers
  readonly layout: BrowserPreviewDeviceLayout
}

type HandleKind = 'horizontal' | 'vertical' | 'corner'

interface HandleDefinition {
  readonly cursorClassName: string
  readonly direction: BrowserPreviewViewportResizeDirection
  readonly kind: HandleKind
  readonly label: string
  readonly mirrorCorner?: boolean
}

const HANDLE_DEFINITIONS = [
  {
    direction: 'west',
    label: 'Resize browser viewport from left edge',
    kind: 'vertical',
    cursorClassName: 'cursor-ew-resize',
  },
  {
    direction: 'east',
    label: 'Resize browser viewport from right edge',
    kind: 'vertical',
    cursorClassName: 'cursor-ew-resize',
  },
  {
    direction: 'south',
    label: 'Resize browser viewport from bottom edge',
    kind: 'horizontal',
    cursorClassName: 'cursor-ns-resize',
  },
  {
    direction: 'southwest',
    label: 'Resize browser viewport from bottom-left corner',
    kind: 'corner',
    cursorClassName: 'cursor-nesw-resize',
    mirrorCorner: true,
  },
  {
    direction: 'southeast',
    label: 'Resize browser viewport from bottom-right corner',
    kind: 'corner',
    cursorClassName: 'cursor-nwse-resize',
  },
] as const satisfies readonly HandleDefinition[]

const EDGE_BUTTON_CLASS =
  "group absolute z-20 touch-none border-0 bg-transparent p-0 before:absolute before:-inset-1 before:content-[''] hover:text-text-primary focus-visible:bg-bg-hover active:text-text-primary"
const EDGE_GRIP_CLASS =
  'pointer-events-none absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center text-text-muted/70 transition-colors duration-150 group-hover:text-text-primary group-focus-visible:text-text-primary'

function handleStyle(
  definition: HandleDefinition,
  layout: BrowserPreviewDeviceLayout,
): CSSProperties {
  const left = layout.x
  const top = layout.y
  const right = left + layout.width
  const bottom = top + layout.height
  const railSize = BROWSER_PREVIEW_VIEWPORT_RESIZE_RAIL_SIZE
  if (definition.direction === 'west') {
    return { left: left - railSize, top, width: railSize, height: layout.height }
  }
  if (definition.direction === 'east') {
    return { left: right, top, width: railSize, height: layout.height }
  }
  if (definition.direction === 'south') {
    return { left, top: bottom, width: layout.width, height: railSize }
  }
  if (definition.direction === 'southwest') {
    return { left: left - railSize, top: bottom, width: railSize, height: railSize }
  }
  return { left: right, top: bottom, width: railSize, height: railSize }
}

function ResizeGrip({ definition }: { readonly definition: HandleDefinition }) {
  if (definition.kind === 'vertical') {
    return (
      <span className="flex gap-px" aria-hidden="true">
        <span className="h-6 w-px rounded-full bg-current" />
        <span className="h-6 w-px rounded-full bg-current" />
      </span>
    )
  }
  if (definition.kind === 'horizontal') {
    return (
      <span className="flex flex-col gap-px" aria-hidden="true">
        <span className="h-px w-6 rounded-full bg-current" />
        <span className="h-px w-6 rounded-full bg-current" />
      </span>
    )
  }
  return (
    <span
      className={cn('relative block size-3', definition.mirrorCorner && '-scale-x-100')}
      aria-hidden="true"
    >
      <span className="absolute bottom-1 left-0 h-px w-3 -rotate-45 rounded-full bg-current" />
      <span className="absolute bottom-0 left-1 h-px w-2 -rotate-45 rounded-full bg-current" />
    </span>
  )
}

function ResizeHandle({
  active,
  definition,
  handlers,
  layout,
}: {
  readonly active: boolean
  readonly definition: HandleDefinition
  readonly handlers: BrowserPreviewViewportResizeHandlers
  readonly layout: BrowserPreviewDeviceLayout
}) {
  return (
    <Button
      variant="unstyled"
      aria-label={`${definition.label}. Use arrow keys to resize.`}
      className={cn(
        EDGE_BUTTON_CLASS,
        definition.kind === 'corner' && 'z-30',
        definition.cursorClassName,
      )}
      data-browser-preview-resize-handle={definition.direction}
      style={handleStyle(definition, layout)}
      onPointerDown={(event) => handlers.onPointerDown(definition.direction, event)}
      onKeyDown={(event) => handlers.onKeyDown(definition.direction, event)}
    >
      <span
        className={cn(
          EDGE_GRIP_CLASS,
          definition.kind === 'vertical' && 'h-8 w-1.5',
          definition.kind === 'horizontal' && 'h-1.5 w-8',
          definition.kind === 'corner' && 'size-3',
          active && 'text-text-primary',
        )}
      >
        <ResizeGrip definition={definition} />
      </span>
    </Button>
  )
}

export function BrowserPreviewViewportResizeHandles({
  activeDirection,
  handlers,
  layout,
}: BrowserPreviewViewportResizeHandlesProps) {
  return HANDLE_DEFINITIONS.map((definition) => (
    <ResizeHandle
      key={definition.direction}
      active={activeDirection === definition.direction}
      definition={definition}
      handlers={handlers}
      layout={layout}
    />
  ))
}
