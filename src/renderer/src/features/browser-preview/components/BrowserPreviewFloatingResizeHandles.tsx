import type { HTMLAttributes } from 'react'
import { Button } from '@/shared/ui/Button'
import type { FloatingResizeDirection } from '../lib/browser-preview-floating-layout'

const HANDLES = [
  { direction: 'north', label: 'top edge', style: 'inset-x-2 -top-1 h-2 cursor-ns-resize' },
  { direction: 'south', label: 'bottom edge', style: 'inset-x-2 -bottom-1 h-2 cursor-ns-resize' },
  { direction: 'east', label: 'right edge', style: 'inset-y-2 -right-1 w-2 cursor-ew-resize' },
  { direction: 'west', label: 'left edge', style: 'inset-y-2 -left-1 w-2 cursor-ew-resize' },
  {
    direction: 'northeast',
    label: 'top-right corner',
    style: '-right-1 -top-1 size-3 cursor-nesw-resize',
  },
  {
    direction: 'northwest',
    label: 'top-left corner',
    style: '-left-1 -top-1 size-3 cursor-nwse-resize',
  },
  {
    direction: 'southeast',
    label: 'bottom-right corner',
    style: '-right-1 -bottom-1 size-3 cursor-nwse-resize',
  },
  {
    direction: 'southwest',
    label: 'bottom-left corner',
    style: '-left-1 -bottom-1 size-3 cursor-nesw-resize',
  },
] as const

export function BrowserPreviewFloatingResizeHandles({
  handlers,
}: {
  readonly handlers: (direction: FloatingResizeDirection) => HTMLAttributes<HTMLElement>
}) {
  return HANDLES.map((handle) => (
    <Button
      key={handle.direction}
      variant="unstyled"
      aria-label={`Resize floating preview from ${handle.label}. Use arrow keys to resize.`}
      className={`absolute z-20 touch-none rounded-sm bg-transparent focus-visible:bg-accent/30 ${handle.style}`}
      data-floating-resize-handle={handle.direction}
      {...handlers(handle.direction)}
    />
  ))
}
