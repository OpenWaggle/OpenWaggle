import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

/**
 * A sticky section heading: label, count, and actions that appear on hover.
 *
 * One component for Pinned and Projects because the prototype styles them identically, and
 * two implementations drifted immediately: the app's Projects heading was 30px at 12px medium
 * with no count, against the prototype's 26px at 11px semibold uppercase with one.
 *
 * Sticky matters at 40 sessions. Scrolling past a project used to leave no indication of which
 * section the rows below belonged to.
 */
export function SidebarSectionHead({
  label,
  count,
  children,
}: {
  readonly label: string
  readonly count: number
  /** Header actions. Hidden until the heading is hovered or holds focus. */
  readonly children?: React.ReactNode
}) {
  return (
    <div
      data-qa="sidebar-section-head"
      className="group/head sticky top-0 z-2 flex h-6.5 items-center gap-1.5 bg-bg-secondary px-3.5 font-semibold text-xs text-text-tertiary uppercase tracking-wider"
    >
      <span>{label}</span>
      <span className="font-medium text-text-muted tracking-normal">{count}</span>
      {children === undefined ? null : (
        <span className="ml-auto flex gap-0.5 opacity-0 transition-opacity group-hover/head:opacity-100 group-focus-within/head:opacity-100">
          {children}
        </span>
      )}
    </div>
  )
}

/**
 * A 20px square icon button, the prototype's `.icon-btn`.
 *
 * Shared so header and row actions are the same size everywhere. The app had several sizes.
 */
export function SidebarIconButton({
  label,
  title,
  isActive = false,
  onClick,
  children,
  ...rest
}: {
  readonly label: string
  readonly title?: string
  readonly isActive?: boolean
  readonly onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  readonly children: React.ReactNode
  // Aria attributes so a Popover trigger can be told it opens a menu, and whether it is open.
} & Record<`data-${string}`, unknown> &
  React.AriaAttributes) {
  return (
    <Button
      variant="unstyled"
      type="button"
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      {...rest}
      className={cn(
        'grid size-5 flex-none place-items-center rounded transition-colors hover:bg-bg-hover hover:text-text-primary',
        isActive ? 'text-accent' : 'text-text-tertiary',
      )}
    >
      {children}
    </Button>
  )
}
