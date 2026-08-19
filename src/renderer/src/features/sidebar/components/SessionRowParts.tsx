import type { SessionSummary } from '@shared/types/session'
import { AlertTriangle, ChevronDown, ChevronRight, MoreHorizontal } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

/**
 * Parts of a two-line session row, split out so the row file stays assembly only.
 */

export interface SessionBranchDisclosure {
  readonly visible: boolean
  readonly collapsed: boolean
  readonly onToggle?: (() => void) | undefined
}

/**
 * Branch disclosure chevron. Owns its own defaults so a row can pass the optional state
 * straight through without unpacking it.
 */
export function SessionBranchDisclosureButton({
  disclosure,
}: {
  readonly disclosure: SessionBranchDisclosure | undefined
}) {
  if (disclosure === undefined || !disclosure.visible) return null

  const { collapsed, onToggle } = disclosure
  const DisclosureIcon = collapsed ? ChevronRight : ChevronDown

  return (
    <Button
      variant="unstyled"
      type="button"
      aria-label={collapsed ? 'Expand branches' : 'Collapse branches'}
      onClick={(event) => {
        event.stopPropagation()
        onToggle?.()
      }}
      className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
    >
      <DisclosureIcon className="size-3" />
    </Button>
  )
}

/**
 * The row's status glyph, in a fixed slot so titles align whether or not a session has one.
 *
 * Interruption wins the slot when a run stopped partway, because a run needing a human
 * outranks background liveness. The status still shows its word on line two.
 */
export function SessionRowGlyph({
  StatusIcon,
  animateClass,
  hasInterruptedRun,
}: {
  readonly StatusIcon: React.ComponentType<{ className?: string }> | null
  readonly animateClass: string | null
  readonly hasInterruptedRun: boolean
}) {
  const Icon = hasInterruptedRun ? AlertTriangle : StatusIcon

  return (
    <span
      title={hasInterruptedRun ? 'A run was interrupted in this session' : undefined}
      className="flex h-[17px] w-3.5 flex-none items-center justify-center text-[color:var(--row-color)]"
    >
      {Icon === null ? null : (
        <Icon className={cn('size-3.5', hasInterruptedRun ? null : animateClass)} />
      )}
    </span>
  )
}

/** Line one: the title owns the full width. Nothing shares it, nothing hides on hover. */
export function SessionRowTitle({
  isActive,
  isInFlight,
  session,
  onSelect,
}: {
  readonly isActive: boolean
  /** In-flight rows recede, so prominence stays with rows that need a human. */
  readonly isInFlight: boolean
  readonly session: SessionSummary
  readonly onSelect: () => void
}) {
  return (
    <span className="flex h-[19px] min-w-0 items-center gap-1.5">
      <Button
        variant="unstyled"
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 truncate text-left leading-[19px]"
      >
        <span
          className={cn(
            'truncate font-medium text-[12.5px] leading-[19px]',
            isActive
              ? 'text-text-primary'
              : isInFlight
                ? 'text-text-tertiary'
                : 'text-text-secondary',
          )}
        >
          {session.title}
        </span>
      </Button>
    </span>
  )
}

export function SessionRowMenuTrigger({
  session,
  onClick,
}: {
  readonly session: SessionSummary
  readonly onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <Button
      variant="unstyled"
      type="button"
      aria-label={`Open session actions for ${session.title}`}
      onClick={onClick}
      className="flex size-5 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
    >
      <MoreHorizontal className="size-3.5" />
    </Button>
  )
}
