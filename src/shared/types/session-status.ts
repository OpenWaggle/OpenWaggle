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
 */
interface SessionStatusPill {
  readonly icon: string
  readonly colorClass: string
  readonly animateClass: string | null
}

const STATUS_PILL_MAP: Record<Exclude<SessionStatus, 'idle'>, SessionStatusPill> = {
  working: {
    icon: 'GitCompareArrows',
    colorClass: 'text-sky-500',
    animateClass: 'animate-pulse',
  },
  connecting: {
    icon: 'Loader2',
    colorClass: 'text-sky-500',
    animateClass: 'animate-spin',
  },
  completed: {
    icon: 'CircleCheck',
    colorClass: 'text-emerald-500',
    animateClass: null,
  },
  'awaiting-input': {
    icon: 'MessageCircle',
    colorClass: 'text-indigo-500',
    animateClass: null,
  },
  'waggle-running': {
    icon: 'WaggleBee',
    colorClass: 'text-amber-500',
    animateClass: 'animate-pulse',
  },
  error: {
    icon: 'XCircle',
    colorClass: 'text-red-500',
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
