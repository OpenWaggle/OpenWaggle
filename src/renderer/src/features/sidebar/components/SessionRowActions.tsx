import type { SessionSummary } from '@shared/types/session'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { formatRelativeTime } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import { SessionPinButton } from './SessionRowPinControls'

function SessionActionsTrigger({
  menuOpen,
  session,
  showTimestamp,
  onClick,
}: {
  readonly menuOpen: boolean
  readonly session: SessionSummary
  /** Pinned rows hide it: those 56px are the difference between a readable title and none. */
  readonly showTimestamp: boolean
  readonly onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <div className={cn('relative h-5 shrink-0', showTimestamp ? 'w-14' : 'w-5')}>
      <Button
        variant="unstyled"
        type="button"
        aria-label={`Open session actions for ${session.title}`}
        onClick={onClick}
        className={cn(
          'peer absolute inset-y-0 right-0 z-10 flex size-5 items-center justify-center rounded text-text-tertiary opacity-0 transition-[background-color,color,opacity] hover:bg-bg-hover hover:text-text-secondary group-hover:opacity-100 focus:opacity-100',
          menuOpen ? 'opacity-100' : null,
        )}
      >
        <MoreHorizontal className="size-3.5" />
      </Button>
      {showTimestamp ? (
        <span
          className={cn(
            'pointer-events-none absolute inset-y-0 right-0 flex items-center text-right text-[11px] text-text-tertiary transition-opacity group-hover:opacity-0 peer-focus:opacity-0',
            menuOpen ? 'opacity-0' : 'opacity-100',
          )}
        >
          {formatRelativeTime(session.updatedAt)}
        </span>
      ) : null}
    </div>
  )
}

/**
 * The row's right-aligned control cluster: pin beside the menu trigger, as in the
 * prototype. Rendered as separate siblings of the title, the pin drifted into the middle
 * of the row and read as an unrelated floating icon.
 */
export function SessionRowActions({
  isPinned,
  menuOpen,
  session,
  showTimestamp,
  onActionsClick,
  onTogglePin,
}: {
  readonly isPinned: boolean
  readonly menuOpen: boolean
  readonly session: SessionSummary
  readonly showTimestamp: boolean
  readonly onActionsClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  readonly onTogglePin: () => void
}) {
  return (
    <div className="ml-auto flex shrink-0 items-center gap-0.5">
      <SessionPinButton
        isPinned={isPinned}
        session={session}
        onClick={(event) => {
          event.stopPropagation()
          onTogglePin()
        }}
      />
      <SessionActionsTrigger
        menuOpen={menuOpen}
        session={session}
        showTimestamp={showTimestamp}
        onClick={onActionsClick}
      />
    </div>
  )
}
