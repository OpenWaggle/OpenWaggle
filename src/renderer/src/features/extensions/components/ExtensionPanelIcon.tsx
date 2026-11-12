import type { ExtensionContributionIconView } from '@shared/types/extension-contribution-registry'
import { cn } from '@/shared/lib/cn'

interface ExtensionPanelIconProps {
  readonly icon?: ExtensionContributionIconView
  readonly title: string
  readonly className?: string
}

/** Same footprint as a lucide-react icon rendered with `size-4`. */
const ICON_SIZE_CLASS = 'size-4 shrink-0'

function svgMaskImage(svg: string) {
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`
}

function fallbackLetter(title: string) {
  const [first] = Array.from(title.trim())
  return first ? first.toLocaleUpperCase() : '?'
}

/**
 * A side panel's Panel rail icon (ADR 0043). The host-validated SVG is only used as a CSS mask
 * over `currentColor`, like VS Code's activity bar, so it takes the rail's colours and is never
 * inserted into the DOM. Without an icon it shows a letter tile.
 */
export function ExtensionPanelIcon({ icon, title, className }: ExtensionPanelIconProps) {
  if (!icon) {
    return (
      <span
        aria-hidden="true"
        data-extension-panel-icon="letter"
        className={cn(
          ICON_SIZE_CLASS,
          'inline-flex items-center justify-center rounded-sm border border-current text-xs leading-none font-semibold',
          className,
        )}
      >
        {fallbackLetter(title)}
      </span>
    )
  }

  const maskImage = svgMaskImage(icon.svg)
  return (
    <span
      aria-hidden="true"
      data-extension-panel-icon={icon.source}
      className={cn(ICON_SIZE_CLASS, 'inline-block bg-current', className)}
      style={{
        maskImage,
        WebkitMaskImage: maskImage,
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
      }}
    />
  )
}
