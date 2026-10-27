import type {
  HeartbeatRunOutcome,
  HeartbeatSettingsInput,
} from '@shared/types/scheduled-task-heartbeat'
import { HEARTBEAT_IDLE_PAUSE_DEFAULT } from '@shared/types/scheduled-task-heartbeat'

/**
 * Every Heartbeat needs a way to finish (#388): a Stop condition, an end date, a run limit, or an
 * explicit `indefinite`. Checked by the Host and, for an early message, by every client.
 */
export function heartbeatHasStopCondition(input: {
  readonly stopWhen?: string | null
  readonly indefinite?: boolean
  readonly endsAt?: number | null
  readonly maxRuns?: number | null
}) {
  return (
    (input.stopWhen !== undefined && input.stopWhen !== null && input.stopWhen.trim() !== '') ||
    input.indefinite === true ||
    (input.endsAt !== undefined && input.endsAt !== null) ||
    (input.maxRuns !== undefined && input.maxRuns !== null)
  )
}

export const HEARTBEAT_STOP_CONDITION_REQUIRED_MESSAGE =
  'A Heartbeat needs a way to finish: set stopWhen (the outcome after which it stops), endsAt, maxRuns, or indefinite: true.'

/** The settings a Heartbeat input names, with the defaults a new Heartbeat gets. */
export function heartbeatSettingsDefaults(input: HeartbeatSettingsInput | undefined) {
  return {
    stopWhen: input?.stopWhen?.trim() || null,
    indefinite: input?.indefinite ?? false,
    idlePauseAfter: input?.idlePauseAfter ?? HEARTBEAT_IDLE_PAUSE_DEFAULT,
  }
}

/** Tools that only read: using nothing else leaves a Run without a reported outcome idle. */
export const HEARTBEAT_READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'read',
  'grep',
  'find',
  'ls',
  'openwaggle_docs',
  'preview_status',
  'preview_snapshot',
])

/** Hive tool actions that only read, and the Run outcome report itself. */
export const HEARTBEAT_READ_ONLY_HIVE_ACTIONS: ReadonlySet<string> = new Set([
  'list',
  'search',
  'read',
  'status',
  'queue_list',
  'requests_list',
  'turns',
  'items',
  'wait',
  'delegations_list',
  'delegations_read',
  'delegations_conflicts',
  'agent_definitions_list',
  'agent_definitions_search',
  'schedule_list',
  'schedule_read',
  'schedule_runs',
  'schedule_outcome',
])

const READ_ONLY_TOOL_ACTIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  hive: HEARTBEAT_READ_ONLY_HIVE_ACTIONS,
  project_actions: new Set(['list', 'discover', 'runs', 'output']),
  source_control: new Set(['status']),
}

export interface HeartbeatToolUse {
  readonly name: string
  readonly args: Readonly<Record<string, unknown>>
}

function isReadOnlyToolUse(use: HeartbeatToolUse) {
  if (HEARTBEAT_READ_ONLY_TOOLS.has(use.name)) return true
  const actions = READ_ONLY_TOOL_ACTIONS[use.name]
  const action = use.args.action
  return actions !== undefined && typeof action === 'string' && actions.has(action)
}

/**
 * The Run outcome of a Heartbeat Run that reported none (CONTEXT.md: Run outcome): `acted` when
 * it used any tool other than a read-only query, `idle` otherwise. A shell command always counts
 * as acting, since its effect cannot be known; a Wake check is how a read-only command stays idle.
 */
export function inferHeartbeatRunOutcome(uses: readonly HeartbeatToolUse[]): HeartbeatRunOutcome {
  return uses.every(isReadOnlyToolUse) ? 'idle' : 'acted'
}

/** The Auto-pause message for `idleRuns` consecutive idle runs. */
export function idleAutoPauseMessage(idleRuns: number) {
  return `auto-paused: ${String(idleRuns)} idle run${idleRuns === 1 ? '' : 's'}`
}

export function doneAutoPauseMessage(note: string | undefined) {
  const trimmed = note?.trim()
  return trimmed ? `auto-paused: done — ${trimmed}` : 'auto-paused: done'
}
