import type { SessionSummary } from '@shared/types/session'
import { cn } from '@/shared/lib/cn'
import { useSessionGitIndicator } from '../hooks/useSessionGitIndicators'

/**
 * This session's working-tree state, from status keyed by its own working path.
 * Absent until that path's status is known, so an unfetched session never looks clean.
 */
export function SessionGitBadge({ session }: { readonly session: SessionSummary }) {
  const indicator = useSessionGitIndicator(session)
  if (indicator.label === '') return null

  return (
    <span
      role="img"
      title={indicator.description}
      aria-label={indicator.description}
      className={cn(
        'ml-1 shrink-0 whitespace-nowrap text-[10px] tabular-nums',
        indicator.isDirty ? 'text-accent' : 'text-text-tertiary',
      )}
    >
      {indicator.label}
    </span>
  )
}
