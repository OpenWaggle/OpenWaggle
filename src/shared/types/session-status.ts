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
  /**
   * One word for the row's second line, so a state is never conveyed by colour alone.
   * Deliberately short: it shares that line with provenance, a shortcut and a timestamp.
   */
  readonly shortLabel: string
  /**
   * The row's accent, as a `var()` reference rather than a class, because a row sets it
   * once and its icon, label and leading border all read from it.
   */
  readonly colorVar: string
  /**
   * The colour for the small text label, where the plain role would fail contrast.
   * Only error needs one: #ef4444 is 4.49:1 on the row background.
   */
  readonly labelColorVar: string
}

const STATUS_PILL_MAP: Record<Exclude<SessionStatus, 'idle'>, SessionStatusPill> = {
  working: {
    icon: 'GitCompareArrows',
    colorClass: 'text-progress',
    animateClass: 'animate-pulse',
    shortLabel: 'Working',
    colorVar: 'var(--color-progress)',
    labelColorVar: 'var(--color-progress)',
  },
  connecting: {
    icon: 'Loader2',
    colorClass: 'text-progress',
    animateClass: 'animate-spin',
    shortLabel: 'Connecting',
    colorVar: 'var(--color-progress)',
    labelColorVar: 'var(--color-progress)',
  },
  completed: {
    icon: 'CircleCheck',
    colorClass: 'text-success',
    animateClass: null,
    shortLabel: 'Done',
    colorVar: 'var(--color-success)',
    labelColorVar: 'var(--color-success)',
  },
  'awaiting-input': {
    icon: 'MessageCircle',
    colorClass: 'text-info',
    animateClass: null,
    shortLabel: 'Input',
    colorVar: 'var(--color-info)',
    labelColorVar: 'var(--color-info)',
  },
  'waggle-running': {
    icon: 'WaggleBee',
    colorClass: 'text-accent',
    animateClass: 'animate-pulse',
    shortLabel: 'Waggle',
    colorVar: 'var(--color-accent)',
    labelColorVar: 'var(--color-accent)',
  },
  error: {
    icon: 'XCircle',
    // Icon, not text: --color-error clears the 3:1 non-text bar. Small error text uses
    // text-error-text instead, which clears 4.5:1.
    colorClass: 'text-error',
    animateClass: null,
    shortLabel: 'Error',
    colorVar: 'var(--color-error)',
    labelColorVar: 'var(--color-error-text)',
  },
}

/**
 * A run that stopped partway and can be resumed. Not a `SessionStatus`: it is recorded per
 * conversation branch, so a session can carry it alongside any status.
 *
 * An interruption is a warning rather than a failure, which is why it takes the warning
 * role instead of the error one.
 */
export const INTERRUPTED_RUN_PILL = {
  shortLabel: 'Interrupted',
  colorVar: 'var(--color-warning)',
  labelColorVar: 'var(--color-warning)',
  description: 'A run was interrupted in this session',
} as const

/** The row accent for a session with nothing pending. Grey, so there is no hue to read. */
export const IDLE_ROW_COLOR_VAR = 'var(--color-neutral)'

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
