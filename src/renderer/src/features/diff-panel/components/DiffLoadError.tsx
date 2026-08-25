import { Button } from '@/shared/ui/Button'

interface DiffLoadErrorProps {
  readonly message: string
  readonly onRetry: () => void
}

/**
 * A diff that could not be read, shown as such.
 *
 * This used to fall through to the empty state, so `not-git-repo`, an unresolvable base ref, a
 * vanished worktree and an IPC transport failure were all reported as "No changes to review" -
 * telling the user their work was committed when the panel simply could not read the tree. That is
 * the worst failure a review surface can have, and it contradicted the reasoning applied to the
 * sidebar indicators, where an absent badge is deliberately not treated as "confirmed clean".
 */
export function DiffLoadError({ message, onRetry }: DiffLoadErrorProps) {
  return (
    <div
      role="alert"
      className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center"
    >
      <span className="text-[12px] font-medium text-text-primary">Could not load this diff</span>
      <span className="max-w-prose text-[11px] text-text-tertiary">{message}</span>
      <Button variant="secondary" size="sm" type="button" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}
