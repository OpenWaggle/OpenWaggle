import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'

type SettingsSectionLayout = 'flow' | 'fill'

interface SettingsSectionContainerProps {
  readonly children: ReactNode
  /**
   * `flow` (default) scrolls the section vertically with the standard Settings padding.
   * `fill` hands the full content area to sections that manage their own panes and scrolling.
   */
  readonly layout?: SettingsSectionLayout
  /** Spacing or layout classes for the section content. Never add a max width here. */
  readonly className?: string
}

/**
 * Root of every Settings tab. It owns the scroll area, padding, and width, so each
 * section fills the space the Settings page gives it.
 */
export function SettingsSectionContainer({
  children,
  layout = 'flow',
  className,
}: SettingsSectionContainerProps) {
  if (layout === 'fill') {
    return (
      <div
        data-settings-section-layout="fill"
        className={cn('flex size-full min-h-0 min-w-0 flex-col', className)}
      >
        {children}
      </div>
    )
  }

  return (
    <div
      data-settings-section-layout="flow"
      className="size-full min-w-0 overflow-y-auto px-4 py-5 @min-[640px]/settings:px-10 @min-[640px]/settings:py-8"
    >
      <div className={cn('w-full min-w-0', className)}>{children}</div>
    </div>
  )
}
