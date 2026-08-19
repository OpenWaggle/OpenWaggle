export type SessionStatus =
  | 'working'
  | 'connecting'
  | 'completed'
  | 'awaiting-input'
  | 'waggle-running'
  | 'error'
  | 'idle'

/**
 * Icon names correspond to Lucide icon component names.
 * Animation class is applied directly to the icon (e.g. 'animate-pulse', 'animate-spin').
 *
 * Colours are semantic design tokens, never raw palette classes. Each status names the
 * role it means, so a theme re-maps the role and every status follows. See ADR 0021.
 */
interface SessionStatusPill {
  readonly icon: string
  readonly colorClass: string
  readonly animateClass: string | null
}

const STATUS_PILL_MAP: Record<Exclude<SessionStatus, 'idle'>, SessionStatusPill> = {
  working: {
    icon: 'GitCompareArrows',
    colorClass: 'text-progress',
    animateClass: 'animate-pulse',
  },
  connecting: {
    icon: 'Loader2',
    colorClass: 'text-progress',
    animateClass: 'animate-spin',
  },
  completed: {
    icon: 'CircleCheck',
    colorClass: 'text-success',
    animateClass: null,
  },
  'awaiting-input': {
    icon: 'MessageCircle',
    colorClass: 'text-info',
    animateClass: null,
  },
  'waggle-running': {
    icon: 'WaggleBee',
    colorClass: 'text-accent',
    animateClass: 'animate-pulse',
  },
  error: {
    icon: 'XCircle',
    // Icon, not text: --color-error clears the 3:1 non-text bar. Small error text uses
    // text-error-text instead, which clears 4.5:1.
    colorClass: 'text-error',
    animateClass: null,
  },
}

/**
 * Statuses that represent a finished run (completed or failed).
 * Used for clear-on-visit notification behavior.
 */
export const TERMINAL_STATUSES: ReadonlySet<SessionStatus> = new Set<SessionStatus>([
  'completed',
  'error',
])

export function resolveSessionStatusPill(status: SessionStatus): SessionStatusPill | null {
  if (status === 'idle') return null
  return STATUS_PILL_MAP[status]
}
