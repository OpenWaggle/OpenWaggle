import type { SessionSummary } from '@shared/types/session'
import { cn } from '@/shared/lib/cn'
import { formatCompactRelativeTime } from '@/shared/lib/format'
import { PINNED_SHORTCUT_LIMIT } from '../lib/pinned-sessions'
import { SessionProvenanceIndicators } from './SessionProvenanceIndicators'
import { SessionGitBadge } from './SessionRowGitBadge'

/**
 * A session row's second line.
 *
 * Two parts with deliberately different behaviour. The lead shrinks and truncates: state,
 * phase, project, provenance. The tail never does: the Pinned shortcut and the timestamp.
 *
 * That split is not cosmetic. When every child on this line was fixed width, a pinned row
 * carrying state, phase, project, branch, marks, shortcut and time grew past the container
 * and scrolled the sidebar sideways. A sidebar must never scroll sideways, so the lead
 * absorbs the pressure and the tail stays readable.
 */
export function SessionRowSecondLine({
  session,
  stateLabel,
  stateColorVar,
  phaseLabel,
  projectLabel,
  shortcutIndex,
}: {
  readonly session: SessionSummary
  readonly stateLabel: string
  readonly stateColorVar: string
  readonly phaseLabel: string | null
  /** Shown only when the row sits outside its project group, as Pinned rows do. */
  readonly projectLabel: string
  readonly shortcutIndex: number | null
}) {
  const showShortcut = shortcutIndex !== null && shortcutIndex < PINNED_SHORTCUT_LIMIT

  return (
    <span
      data-qa="sidebar-row-line2"
      className="flex h-4 min-w-0 max-w-full items-center gap-1.5 text-[10.5px] text-text-tertiary leading-[1.45]"
    >
      <span
        data-qa="sidebar-row-lead"
        className="flex min-w-0 flex-auto items-center gap-[5px] overflow-hidden whitespace-nowrap"
      >
        {stateLabel === '' ? null : (
          <span
            data-qa="sidebar-row-state"
            className="shrink-0 font-bold tracking-[0.02em]"
            style={{ color: stateColorVar }}
          >
            {stateLabel}
          </span>
        )}
        {phaseLabel === null ? null : (
          <>
            <Separator />
            <span className="shrink-0 text-progress">{phaseLabel}</span>
          </>
        )}
        {projectLabel === '' ? null : (
          <>
            <Separator />
            <span title={projectLabel} className="min-w-0 truncate">
              {projectLabel}
            </span>
          </>
        )}
        <SessionProvenanceIndicators session={session} />
        <SessionGitBadge session={session} />
      </span>

      <span data-qa="sidebar-row-tail" className="flex flex-none items-center gap-1.5">
        {showShortcut ? (
          <span
            aria-hidden="true"
            className="flex-none rounded border border-border-light bg-bg-tertiary px-1 py-0.5 font-mono text-[10px] text-text-tertiary leading-none"
          >
            {`\u2318${String(shortcutIndex + 1)}`}
          </span>
        ) : null}
        {/*
         * Never hidden on hover. Hiding it re-flowed the row under the cursor and removed
         * information at the moment the user was about to act on it, so the hover actions
         * overlay line one instead.
         */}
        <span data-qa="sidebar-row-when" className="flex-none tabular-nums">
          {formatCompactRelativeTime(session.updatedAt)}
        </span>
      </span>
    </span>
  )
}

function Separator() {
  return (
    <span aria-hidden="true" className="flex-none opacity-45">
      &middot;
    </span>
  )
}

/**
 * Hover actions, positioned over line one's right edge rather than in the row's flow.
 *
 * Purely additive by design: in flow they displaced the timestamp and shifted the row's
 * content sideways as the pointer arrived. The gradient keeps the title readable where it
 * passes underneath.
 */
export function SessionRowHoverActions({
  isActive,
  menuOpen,
  children,
}: {
  readonly isActive: boolean
  readonly menuOpen: boolean
  readonly children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'absolute top-[5px] right-2 z-10 flex gap-px pl-3.5 transition-opacity',
        'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
        menuOpen ? 'opacity-100' : null,
        isActive
          ? '[background:linear-gradient(90deg,transparent,var(--color-bg-active)_22%)]'
          : '[background:linear-gradient(90deg,transparent,var(--color-bg-hover)_22%)]',
      )}
    >
      {children}
    </span>
  )
}
