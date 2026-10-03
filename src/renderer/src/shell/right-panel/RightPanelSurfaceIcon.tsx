import { ExtensionPanelIcon } from '@/features/extensions'
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
    <ExtensionPanelIcon
      {...(glyph.icon ? { icon: glyph.icon } : {})}
      title={title}
      className={className}
    />
  )
}
