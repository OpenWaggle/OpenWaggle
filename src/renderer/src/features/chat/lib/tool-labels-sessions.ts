import type { JsonObject } from '@shared/types/json'
import { arrayLength, plural, stringArg, type ToolLabel, withDetail } from './tool-label-parts'

/** The Pi tool through which an agent coordinates its Workers (to be renamed `hive`, ADR 0053). */
export const SESSIONS_TOOL_NAME = 'sessions'

/** How much of a title or objective a row shows; the full text is in the expanded arguments. */
const DETAIL_MAX_CHARS = 80

/**
 * The Session a sessions-tool call acts on, as the Hive panel knows it: its current title, its
 * Agent definition, and whether it is a Worker of this Hive.
 */
export interface SessionsToolTarget {
  readonly title: string
  readonly agentName: string | null
  readonly isWorker: boolean
}

interface ActionVerbs {
  readonly running: string
  readonly done: string
  /** The action names the Session it acts on, as in "Messaged Worker · Review". */
  readonly targeted: boolean
}

function targeted(running: string, done: string): ActionVerbs {
  return { running, done, targeted: true }
}

function untargeted(running: string, done: string): ActionVerbs {
  return { running, done, targeted: false }
}

/** Every action of the sessions tool (`sessions-tool-*-parameters.ts`), by what it does. */
const ACTION_VERBS: ReadonlyMap<string, ActionVerbs> = new Map(
  Object.entries({
    spawn: targeted('Spawning', 'Spawned'),
    launch: targeted('Launching', 'Launched'),
    create: targeted('Creating', 'Created'),
    fork: targeted('Forking', 'Forked'),
    message: targeted('Messaging', 'Messaged'),
    start: targeted('Starting', 'Started'),
    follow_up: targeted('Sending a follow-up to', 'Sent a follow-up to'),
    steer: targeted('Steering', 'Steered'),
    replace: targeted('Restarting', 'Restarted'),
    promote: targeted('Promoting a follow-up for', 'Promoted a follow-up for'),
    interrupt: targeted('Interrupting', 'Interrupted'),
    interrupt_descendants: targeted('Interrupting the Workers of', 'Interrupted the Workers of'),
    report: targeted('Reporting to', 'Reported to'),
    handoff: targeted('Handing off', 'Handed off'),
    rename: targeted('Renaming', 'Renamed'),
    archive: targeted('Archiving', 'Archived'),
    unarchive: targeted('Restoring', 'Restored'),
    read: targeted('Reading', 'Read'),
    status: targeted('Checking', 'Checked'),
    turns: targeted('Reading', 'Read'),
    items: targeted('Reading', 'Read'),
    queue_list: targeted('Reading follow-ups of', 'Read follow-ups of'),
    queue_withdraw: targeted('Withdrawing follow-ups of', 'Withdrew follow-ups of'),
    queue_reorder: targeted('Reordering follow-ups of', 'Reordered follow-ups of'),
    queue_pause: targeted('Pausing follow-ups of', 'Paused follow-ups of'),
    queue_resume: targeted('Resuming follow-ups of', 'Resumed follow-ups of'),
    requests_list: targeted('Reading requests of', 'Read requests of'),
    request_respond: targeted('Answering a request of', 'Answered a request of'),
    approval_respond: targeted('Answering an approval for', 'Answered an approval for'),
    authorization_set: targeted('Setting access for', 'Set access for'),
    export: targeted('Exporting', 'Exported'),
    export_create: targeted('Starting an export of', 'Started an export of'),
    export_cancel: targeted('Cancelling an export of', 'Cancelled an export of'),
    exports_list: targeted('Listing exports of', 'Listed exports of'),
    exports_read: targeted('Checking an export of', 'Checked an export of'),
    exports_wait: targeted('Waiting on an export of', 'Waited on an export of'),
    list: untargeted('Listing sessions', 'Listed sessions'),
    search: untargeted('Searching sessions', 'Searched sessions'),
    delegation_submit: untargeted('Submitting work', 'Submitted work'),
    delegation_accept: untargeted("Accepting a Worker's work", "Accepted a Worker's work"),
    delegation_request_revision: untargeted('Requesting a revision', 'Requested a revision'),
    delegation_verify: untargeted("Verifying a Worker's work", "Verified a Worker's work"),
    delegation_reopen: untargeted('Reopening a delegation', 'Reopened a delegation'),
    delegation_cancel: untargeted('Cancelling a delegation', 'Cancelled a delegation'),
    delegations_list: untargeted('Listing delegations', 'Listed delegations'),
    delegations_read: untargeted('Reading a delegation', 'Read a delegation'),
    delegations_conflicts: untargeted(
      'Checking delegation conflicts',
      'Checked delegation conflicts',
    ),
    agent_definitions_list: untargeted('Listing agents', 'Listed agents'),
    agent_definitions_search: untargeted('Searching agents', 'Searched agents'),
  }),
)

function actionVerbs(action: string): ActionVerbs | null {
  const known = ACTION_VERBS.get(action)
  if (known) return known
  // The remaining delegation actions (state, claim, dependency, amendments…) all update it.
  if (action.startsWith('delegation_')) {
    return untargeted('Updating a delegation', 'Updated a delegation')
  }
  return null
}

/** The first line of a long title or objective, cut to fit a row and its accessible name. */
function shortDetail(text: string | null) {
  if (!text) return null
  const line =
    text
      .split('\n')
      .find((candidate) => candidate.trim())
      ?.trim() ?? ''
  if (line.length <= DETAIL_MAX_CHARS) return line || null
  return `${line.slice(0, DETAIL_MAX_CHARS - 1).trimEnd()}…`
}

function workerPhrase(agentName: string | null, title: string | null) {
  return withDetail(agentName ? `Worker (${agentName})` : 'Worker', shortDetail(title))
}

/** A new Session's name before the Hive knows it: what the spawning call asked for. */
function requestedTarget(action: string, args: JsonObject): SessionsToolTarget | null {
  const title = stringArg(args, 'title') ?? stringArg(args, 'objective')
  if (action === 'spawn') {
    return { title: title ?? '', agentName: stringArg(args, 'agent'), isWorker: true }
  }
  if (action === 'launch' || action === 'create') {
    return { title: title ?? '', agentName: stringArg(args, 'agent'), isWorker: false }
  }
  return null
}

/** Who an unresolved report went to; a reported Session the Hive does not know is a Worker. */
function reportTargetPhrase(args: JsonObject) {
  const target = args.target
  if (target === null || typeof target !== 'object' || Array.isArray(target)) return 'Worker'
  if (target.type === 'queen') return 'the Queen'
  if (target.type === 'upstream') return 'its parent'
  if (target.type === 'sessions' && Array.isArray(target.sessionIds)) {
    return plural(target.sessionIds.length, 'Worker')
  }
  return 'Worker'
}

/**
 * The Session an action names: "Worker (reviewer) · Review tool icons" for a Worker, "session ·
 * Audit deps" for a Session outside the Hive, and a bare "Worker" when the title is unknown.
 */
function targetPhrase(action: string, args: JsonObject, target: SessionsToolTarget | null) {
  if (action === 'report' && !target) return reportTargetPhrase(args)
  const known = target ?? requestedTarget(action, args)
  // A fork's source is often the calling Session itself, which need not be a Worker.
  if (!known) return action === 'fork' ? 'session' : 'Worker'
  if (known.isWorker) return workerPhrase(known.agentName, known.title)
  const name = known.agentName ? `session (${known.agentName})` : 'session'
  return withDetail(name, shortDetail(known.title))
}

function waitLabel(args: JsonObject): ToolLabel {
  const count = arrayLength(args, 'sessionIds')
  const workers = count === null ? 'Workers' : plural(count, 'Worker')
  return {
    running: `Waiting on ${workers}...`,
    done: `Waited on ${workers}`,
    requested: `Requested a wait on ${workers}`,
  }
}

function requestedText(running: string) {
  return `Requested: ${running.charAt(0).toLowerCase()}${running.slice(1)}`
}

/**
 * The sessions tool, named for the Workers it coordinates (ADR 0053). `target` is the Session the
 * call acts on as the Hive knows it now, so a row keeps the title the Hive panel shows.
 */
export function sessionsLabel(args: JsonObject, target: SessionsToolTarget | null): ToolLabel {
  const action = stringArg(args, 'action') ?? ''
  if (action === 'wait') return waitLabel(args)
  const verbs = actionVerbs(action)
  // An action this list does not know yet keeps its name visible.
  if (!verbs) {
    const name = action ? `Hive action · ${action}` : 'Hive action'
    return { running: `${name}...`, done: name, requested: `Requested ${name}` }
  }
  if (!verbs.targeted) {
    const detail = shortDetail(stringArg(args, 'query'))
    const running = withDetail(verbs.running, detail)
    return {
      running: `${running}...`,
      done: withDetail(verbs.done, detail),
      requested: requestedText(running),
    }
  }
  const phrase = targetPhrase(action, args, target)
  const running = `${verbs.running} ${phrase}`
  return {
    running: `${running}...`,
    done: `${verbs.done} ${phrase}`,
    requested: requestedText(running),
  }
}

/**
 * `wait` calls get no row, as in Codex: a spawn row's live state shows what the wait is for. A
 * call whose action has not streamed in yet gets none either, so a wait never flashes a row.
 */
export function isHiddenSessionsToolCall(name: string, args: JsonObject, state?: string) {
  if (name !== SESSIONS_TOOL_NAME) return false
  const action = stringArg(args, 'action')
  return action === 'wait' || (action === null && state === 'input-streaming')
}

interface MessagePartLike {
  readonly type: string
  readonly name?: string
  readonly arguments?: string
  readonly state?: string
  readonly content?: unknown
}

/**
 * Whether a message shows nothing but hidden Worker waits (and their results), so its bubble
 * would be an empty row with hover actions. `parseArgs` is the transcript's argument parser.
 */
export function showsOnlyHiddenSessionsToolCalls(
  parts: readonly MessagePartLike[],
  parseArgs: (args: string) => JsonObject,
) {
  let hidden = 0
  for (const part of parts) {
    if (part.type === 'tool-result') continue
    if (part.type === 'tool-call') {
      if (
        !isHiddenSessionsToolCall(part.name ?? '', parseArgs(part.arguments ?? '{}'), part.state)
      ) {
        return false
      }
      hidden += 1
      continue
    }
    if ((part.type === 'text' || part.type === 'thinking') && typeof part.content === 'string') {
      if (part.content.trim()) return false
      continue
    }
    return false
  }
  return hidden > 0
}
