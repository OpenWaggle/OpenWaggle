export type ThreadStatus =
  | 'working'
  | 'connecting'
  | 'completed'
  | 'pending-approval'
  | 'awaiting-input'
  | 'plan-ready'
  | 'waggle-running'
  | 'error'
  | 'idle'

/**
 * Icon names correspond to Lucide icon component names.
 * Animation class is applied directly to the icon (e.g. 'animate-pulse', 'animate-spin').
 */
export interface ThreadStatusPill {
  readonly icon: string
  readonly colorClass: string
  readonly animateClass: string | null
}

const STATUS_PILL_MAP: Record<Exclude<ThreadStatus, 'idle'>, ThreadStatusPill> = {
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
  'pending-approval': {
    icon: 'CirclePause',
    colorClass: 'text-amber-500',
    animateClass: null,
  },
  'awaiting-input': {
    icon: 'MessageCircle',
    colorClass: 'text-indigo-500',
    animateClass: null,
  },
  'plan-ready': {
    icon: 'ClipboardList',
    colorClass: 'text-violet-500',
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
export const TERMINAL_STATUSES: ReadonlySet<ThreadStatus> = new Set<ThreadStatus>([
  'completed',
  'error',
])

export function resolveThreadStatusPill(status: ThreadStatus): ThreadStatusPill | null {
  if (status === 'idle') return null
  return STATUS_PILL_MAP[status]
}
