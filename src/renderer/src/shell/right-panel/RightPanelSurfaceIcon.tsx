import { cn } from '@/shared/lib/cn'
import type { RightPanelSurfaceGlyph } from './useRightPanelModel'

/** A surface's icon: a Lucide glyph, or an extension icon with a letter-tile fallback. */
export function RightPanelSurfaceIcon({
  glyph,
  title,
  className,
}: {
  readonly glyph: RightPanelSurfaceGlyph
  readonly title: string
  readonly className?: string
}) {
  if (glyph.kind === 'lucide') {
    const Icon = glyph.icon
    return <Icon aria-hidden="true" className={cn('size-4 shrink-0', className)} />
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-4 shrink-0 place-items-center rounded-sm bg-bg-hover text-xs font-semibold leading-none text-text-secondary ring-1 ring-border',
        className,
      )}
    >
      {title.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}
