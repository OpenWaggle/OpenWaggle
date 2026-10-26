import type { SessionSummary } from '@shared/types/session'
import { ChessQueen, Pencil, Pickaxe } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { formatCompactRelativeTime } from '@/shared/lib/format'
import { PINNED_SHORTCUT_LIMIT } from '../lib/pinned-sessions'
import { sessionLineagePresentation } from '../lib/session-lineage'
import { NO_QUEEN_WORKER_ATTENTION, type QueenWorkerAttention } from '../lib/worker-attention'
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
  workerAttention = NO_QUEEN_WORKER_ATTENTION,
  showLineageParent = false,
}: {
  readonly session: SessionSummary
  readonly stateLabel: string
  readonly stateColorVar: string
  readonly phaseLabel: string | null
  /** Shown only when the row sits outside its project group, as Pinned rows do. */
  readonly projectLabel: string
  readonly shortcutIndex: number | null
  /** A Queen's hidden Workers: "n need you", and a muted "n waiting for ‹Queen›" (ADR 0059). */
  readonly workerAttention?: QueenWorkerAttention
  /** Name the Worker's parent in text, for Pinned and narrowed flat Worker rows. */
  readonly showLineageParent?: boolean
}) {
  const showShortcut = shortcutIndex !== null && shortcutIndex < PINNED_SHORTCUT_LIMIT
  const waitingOnEdit = session.followUpEditHeldAt !== undefined
  // The lineage glyph follows whichever of the state and the edit wait came before it.
  const leadBeforeLineage = stateLabel !== '' || waitingOnEdit

  return (
    <span
      data-qa="sidebar-row-line2"
      className="flex h-4 min-w-0 max-w-full items-center gap-1.5 text-xs text-text-tertiary leading-normal"
    >
      <span
        data-qa="sidebar-row-lead"
        className="flex min-w-0 flex-auto items-center gap-1.5 overflow-hidden whitespace-nowrap"
      >
        {stateLabel === '' ? null : (
          <span
            data-qa="sidebar-row-state"
            className="shrink-0 font-bold tracking-wide"
            style={{ color: stateColorVar }}
          >
            {stateLabel}
          </span>
        )}
        {waitingOnEdit ? (
          <>
            {stateLabel === '' ? null : <Separator />}
            <FollowUpEditWaitIndicator />
          </>
        ) : null}
        <HiveLineageLead
          session={session}
          showParent={showLineageParent}
          attention={workerAttention}
          leadBeforeLineage={leadBeforeLineage}
        />
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
            className="flex-none rounded border border-border-light bg-bg-tertiary px-1 py-0.5 font-mono text-xs text-text-tertiary leading-none"
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

/**
 * The row's Hive metadata: the lineage glyph, the parent name where it applies, and what a
 * Queen's hidden Workers need (ADR 0051, ADR 0059). Nothing renders for an independent session.
 */
function HiveLineageLead({
  session,
  showParent,
  attention,
  leadBeforeLineage,
}: {
  readonly session: SessionSummary
  readonly showParent: boolean
  readonly attention: QueenWorkerAttention
  readonly leadBeforeLineage: boolean
}) {
  const role = session.lineage?.role
  if (role !== 'queen' && role !== 'worker') return null
  return (
    <>
      {leadBeforeLineage ? <Separator /> : null}
      <SessionLineageIndicator session={session} showParent={showParent} />
      {role === 'queen' ? (
        <QueenWorkerLine attention={attention} queenTitle={session.title} />
      ) : null}
    </>
  )
}

/**
 * What a Queen's hidden Workers need (ADR 0059): "n need you" in the attention colour, then a
 * muted "n waiting for ‹Queen›", which never takes the attention colour or a dot: those Workers
 * wait for her, not for the person.
 */
function QueenWorkerLine({
  attention,
  queenTitle,
}: {
  readonly attention: QueenWorkerAttention
  readonly queenTitle: string
}) {
  return (
    <>
      {attention.needYou > 0 ? (
        <>
          <Separator />
          <span data-qa="sidebar-row-worker-attention" className="shrink-0 text-warning">
            {`${attention.needYou} ${attention.needYou === 1 ? 'needs' : 'need'} you`}
          </span>
        </>
      ) : null}
      {attention.waiting > 0 ? (
        <>
          <Separator />
          <span
            data-qa="sidebar-row-worker-waiting"
            className="min-w-0 truncate text-text-tertiary"
            title={`${attention.waiting} waiting for ${queenTitle}`}
          >
            {`${attention.waiting} waiting for ${queenTitle}`}
          </span>
        </>
      ) : null}
    </>
  )
}

/** Hive lineage is row metadata, so it sits below the title with the other indicators. */
export function SessionLineageIndicator({
  session,
  showParent = false,
}: {
  readonly session: SessionSummary
  /** Render the parent's title as text, for pinned and narrowed Worker rows (ADR 0051). */
  readonly showParent?: boolean
}) {
  const lineage = sessionLineagePresentation(session)
  if (lineage === null) return null
  const LineageIcon = lineage.role === 'queen' ? ChessQueen : Pickaxe

  return (
    <span
      data-qa="sidebar-session-lineage"
      role="img"
      aria-label={lineage.title}
      title={lineage.title}
      className="pointer-events-none inline-flex shrink-0 items-center gap-0.5 text-text-tertiary"
    >
      <LineageIcon className="size-3.5" />
      {lineage.workerCount > 0 ? (
        <span className="text-xs tabular-nums">{lineage.workerCount}</span>
      ) : null}
      {showParent && lineage.role === 'worker' && session.lineage?.parentTitle ? (
        <span className="min-w-0 truncate">Spawned by {session.lineage.parentTitle}</span>
      ) : null}
    </span>
  )
}

/**
 * A queued message is held for the user's edit, so the queue is not delivering. Info: a person is
 * needed (ADR 0021). Text, not only a glyph, because the hold blocks the Session until it ends.
 */
function FollowUpEditWaitIndicator() {
  return (
    <span
      data-qa="sidebar-row-edit-wait"
      className="inline-flex shrink-0 items-center gap-0.5 text-info-text"
    >
      <Pencil aria-hidden="true" className="size-3" />
      Waiting on your edit
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
  onActiveBackground,
  menuOpen,
  children,
}: {
  /** The row wears `bg-bg-active` (open row or Hive home), so the gradient must blend into it. */
  readonly onActiveBackground: boolean
  readonly menuOpen: boolean
  readonly children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'absolute top-1.5 right-2 z-10 flex gap-px pl-3.5 transition-opacity',
        'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
        menuOpen ? 'opacity-100' : null,
        onActiveBackground
          ? '[background:linear-gradient(90deg,transparent,var(--color-bg-active)_22%)]'
          : '[background:linear-gradient(90deg,transparent,var(--color-bg-hover)_22%)]',
      )}
    >
      {children}
    </span>
  )
}
