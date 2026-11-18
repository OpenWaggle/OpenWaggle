import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'

interface ComposerDockProps {
  readonly children: ReactNode
  readonly className?: string
}

/**
 * Inset chrome that docks into the composer's rounded shoulders.
 *
 * Queued turns and the session context use this same shell so neither becomes a
 * second full-width header above the prompt. Width belongs to the child, while
 * this shell keeps both uses aligned to the same composer inset.
 */
export function ComposerDock({ children, className }: ComposerDockProps) {
  return (
    <div className="mx-3.5 -mb-px min-w-0">
      <div
        className={cn(
          'rounded-t-xl border-x border-t border-border-light bg-bg-secondary',
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}
