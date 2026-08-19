import type { SessionSummary } from '@shared/types/session'
import { useSessionGitIndicator } from '../hooks/useSessionGitIndicators'

/**
 * This session's commits ahead of and behind its upstream, from status keyed by its own
 * working path. Absent until that path's status is known, so an unfetched session never
 * looks clean.
 *
 * Always muted. Colour in a session row means "what this session needs from you", and
 * being ahead of upstream needs nothing, so this badge never competes for that meaning.
 */
export function SessionGitBadge({ session }: { readonly session: SessionSummary }) {
  const indicator = useSessionGitIndicator(session)
  if (indicator.label === '') return null

  return (
    <span
      role="img"
      title={indicator.description}
      aria-label={indicator.description}
      className="ml-1 shrink-0 whitespace-nowrap text-[10px] text-text-tertiary tabular-nums"
    >
      {indicator.label}
    </span>
  )
}
