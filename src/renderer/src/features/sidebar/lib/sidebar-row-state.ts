import type { SessionSummary } from '@shared/types/session'
import {
  IDLE_ROW_COLOR_VAR,
  INTERRUPTED_RUN_PILL,
  resolveSessionStatusPill,
  type SessionStatus,
  TERMINAL_STATUSES,
} from '@shared/types/session-status'

/**
 * What a sidebar row reports, which is a session's status plus one thing status cannot say.
 *
 * `interrupted` is not a `SessionStatus`: an interrupted run is recorded per conversation
 * branch, so a session can carry it under any status. The sidebar still has to rank it
 * against the others, because a run that stopped partway needs a human more than a run that
 * is merely busy.
 */
export type SidebarRowState = SessionStatus | 'interrupted'

/** How loudly a state reads. One tier needs a human, one is in flight, one is quiet. */
export type SidebarRowTier = 'attention' | 'in-flight' | 'quiet'

interface SidebarRowStateMeta {
  /** Lower wins when one row could report several states. Copied from T3Code's resolver. */
  readonly rank: number
  readonly tier: SidebarRowTier
  /** One word for the row's second line, so state is never colour alone. Empty for idle. */
  readonly shortLabel: string
  /** Full wording for chips and accessible names. */
  readonly label: string
  readonly colorVar: string
  readonly labelColorVar: string
}

const IDLE_META: SidebarRowStateMeta = {
  rank: 9,
  tier: 'quiet',
  shortLabel: '',
  label: 'Idle',
  colorVar: IDLE_ROW_COLOR_VAR,
  labelColorVar: IDLE_ROW_COLOR_VAR,
}

/**
 * Ranked, and the ranking is the design.
 *
 * Awaiting input outranks a failure because a question blocks progress until answered, a
 * failure is already over. Both outrank anything in flight. `completed` sits above `idle`
 * because "finished while you were away" is news; once seen, the row resolves to idle.
 */
const ROW_STATE_META: Record<SidebarRowState, SidebarRowStateMeta> = {
  'awaiting-input': {
    rank: 0,
    tier: 'attention',
    shortLabel: 'Input',
    label: 'Needs your input',
    colorVar: 'var(--color-info)',
    labelColorVar: 'var(--color-info-text)',
  },
  interrupted: {
    rank: 1,
    tier: 'attention',
    shortLabel: INTERRUPTED_RUN_PILL.shortLabel,
    label: 'Run interrupted, resumable',
    colorVar: INTERRUPTED_RUN_PILL.colorVar,
    labelColorVar: INTERRUPTED_RUN_PILL.labelColorVar,
  },
  error: {
    rank: 2,
    tier: 'attention',
    shortLabel: 'Error',
    label: 'Run failed',
    colorVar: 'var(--color-error)',
    labelColorVar: 'var(--color-error-text)',
  },
  working: {
    rank: 3,
    tier: 'in-flight',
    shortLabel: 'Working',
    label: 'Working',
    colorVar: 'var(--color-progress)',
    labelColorVar: 'var(--color-progress)',
  },
  connecting: {
    rank: 4,
    tier: 'in-flight',
    shortLabel: 'Connecting',
    label: 'Connecting',
    colorVar: 'var(--color-progress)',
    labelColorVar: 'var(--color-progress)',
  },
  'waggle-running': {
    rank: 5,
    tier: 'in-flight',
    shortLabel: 'Waggle',
    label: 'Waggle review running',
    colorVar: 'var(--color-accent)',
    labelColorVar: 'var(--color-accent)',
  },
  completed: {
    rank: 6,
    tier: 'quiet',
    shortLabel: 'Done',
    label: 'Finished while you were away',
    colorVar: 'var(--color-success)',
    labelColorVar: 'var(--color-success)',
  },
  idle: IDLE_META,
}

export function sidebarRowStateMeta(state: SidebarRowState) {
  return ROW_STATE_META[state]
}

/**
 * The one tier authority.
 *
 * A row used to resolve its own tier from a second table, which disagreed with this one about
 * `waggle-running`: the row treated it as quiet, so a Waggle run never receded and never showed
 * its phase, while the project heading counted it as in flight. A heading and a row describing the
 * same session differently is the exact failure two tables guarantee eventually.
 */
export function isAttentionState(state: SidebarRowState) {
  return ROW_STATE_META[state].tier === 'attention'
}

export function isInFlightState(state: SidebarRowState) {
  return ROW_STATE_META[state].tier === 'in-flight'
}

/** The icon name for a state, reusing the status pill's icon and warning for interruption. */
export function sidebarRowStateIcon(state: SidebarRowState) {
  if (state === 'interrupted') return 'AlertTriangle'
  return resolveSessionStatusPill(state)?.icon ?? null
}

/**
 * The single state a row reports.
 *
 * An interruption wins over the session's own status, because the row has one glyph and one
 * word and they should describe the thing that needs a person.
 */
export function resolveSidebarRowState(input: {
  readonly status: SessionStatus
  readonly hasInterruptedRun: boolean
}): SidebarRowState {
  return input.hasInterruptedRun ? 'interrupted' : input.status
}

/** True when any of a session's conversation branches holds an interrupted run. */
export function sessionHasInterruptedRun(session: SessionSummary) {
  return session.branches?.some((branch) => branch.interruptedRun) ?? false
}

export interface SidebarStateCount {
  readonly state: SidebarRowState
  readonly count: number
}

/**
 * Count sessions by the state they report, ranked, dropping states that say nothing.
 *
 * `idle` is excluded on purpose: a chip for "nothing is happening" would be the largest
 * number in the sidebar and the least useful, and it cannot be acted on.
 */
export function buildSidebarStateCounts(
  sessions: readonly SessionSummary[],
  stateOf: (session: SessionSummary) => SidebarRowState,
): readonly SidebarStateCount[] {
  const counts = new Map<SidebarRowState, number>()

  for (const session of sessions) {
    if (session.archived === true) continue
    const state = stateOf(session)
    if (ROW_STATE_META[state].shortLabel === '') continue
    counts.set(state, (counts.get(state) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([state, count]) => ({ state, count }))
    .sort((a, b) => ROW_STATE_META[a.state].rank - ROW_STATE_META[b.state].rank)
}

/**
 * A project's roll-up: only states worth surfacing on a collapsed heading.
 *
 * Restricted to the loud and in-flight tiers. A heading exists to answer "is there anything
 * in here for me", and a count of finished or idle sessions does not answer it.
 */
export function buildProjectRollUp(
  sessions: readonly SessionSummary[],
  stateOf: (session: SessionSummary) => SidebarRowState,
): readonly SidebarStateCount[] {
  return buildSidebarStateCounts(sessions, stateOf).filter(
    ({ state }) => ROW_STATE_META[state].tier !== 'quiet',
  )
}

/**
 * The status a row should show, which is not always the status the store holds.
 *
 * A finished run the user has already seen reads as idle. Without that, a completed session keeps
 * its tick forever and the tick stops meaning "this finished while you were away".
 *
 * One function because the rule was written twice, once in the hook a row uses and once in the hook
 * the chips and roll-ups use. They agreed only because two copies happened to match, so a row and
 * its own project heading were one edit away from describing the same session differently.
 */
export function resolveVisibleSessionStatus(input: {
  readonly status: SessionStatus
  readonly completedAt: number | undefined
  readonly lastVisitedAt: number | undefined
}): SessionStatus {
  const seen =
    TERMINAL_STATUSES.has(input.status) &&
    input.completedAt !== undefined &&
    input.lastVisitedAt !== undefined &&
    input.completedAt <= input.lastVisitedAt

  return seen ? 'idle' : input.status
}
