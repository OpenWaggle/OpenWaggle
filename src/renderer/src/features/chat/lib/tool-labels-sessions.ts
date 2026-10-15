import type { JsonObject } from '@shared/types/json'
import {
  arrayLength,
  label,
  plural,
  stringArg,
  type ToolLabel,
  type Verbs,
} from './tool-label-parts'

const SUBAGENTS_TITLE = 'sub-agents'
/** How much of an objective a row shows; the full text is in the expanded arguments. */
const DETAIL_MAX_CHARS = 80
const GENERIC_VERBS: Verbs = { running: 'Sub-agents', done: 'Sub-agents' }

function verbs(running: string, done: string): Verbs {
  return { running, done }
}

/** Every action of the sessions tool (`sessions-tool-*-parameters.ts`), by what it does. */
const SESSION_VERBS: ReadonlyMap<string, Verbs> = new Map(
  Object.entries({
    spawn: verbs('Spawning sub-agent', 'Spawned sub-agent'),
    launch: verbs('Launching session', 'Launched session'),
    create: verbs('Creating session', 'Created session'),
    fork: verbs('Forking session', 'Forked session'),
    message: verbs('Messaging sub-agent', 'Messaged sub-agent'),
    start: verbs('Starting sub-agent', 'Started sub-agent'),
    follow_up: verbs('Sending follow-up', 'Sent follow-up'),
    steer: verbs('Steering sub-agent', 'Steered sub-agent'),
    replace: verbs('Restarting sub-agent', 'Restarted sub-agent'),
    promote: verbs('Promoting follow-up', 'Promoted follow-up'),
    interrupt: verbs('Interrupting sub-agent', 'Interrupted sub-agent'),
    interrupt_descendants: verbs('Interrupting sub-agents', 'Interrupted sub-agents'),
    report: verbs('Sending report', 'Sent report'),
    handoff: verbs('Handing off session', 'Handed off session'),
    rename: verbs('Renaming session', 'Renamed session'),
    archive: verbs('Archiving session', 'Archived session'),
    unarchive: verbs('Restoring session', 'Restored session'),
    list: verbs('Listing sessions', 'Listed sessions'),
    search: verbs('Searching sessions', 'Searched sessions'),
    read: verbs('Reading session', 'Read session'),
    status: verbs('Checking session', 'Checked session'),
    turns: verbs('Reading session', 'Read session'),
    items: verbs('Reading session', 'Read session'),
    queue_list: verbs('Reading follow-ups', 'Read follow-ups'),
    queue_withdraw: verbs('Withdrawing follow-ups', 'Withdrew follow-ups'),
    queue_reorder: verbs('Reordering follow-ups', 'Reordered follow-ups'),
    queue_pause: verbs('Pausing follow-ups', 'Paused follow-ups'),
    queue_resume: verbs('Resuming follow-ups', 'Resumed follow-ups'),
    requests_list: verbs('Reading sub-agent requests', 'Read sub-agent requests'),
    request_respond: verbs('Answering sub-agent request', 'Answered sub-agent request'),
    approval_respond: verbs('Answering approval', 'Answered approval'),
    authorization_set: verbs('Setting sub-agent access', 'Set sub-agent access'),
    export: verbs('Exporting session', 'Exported session'),
    export_create: verbs('Exporting session', 'Started session export'),
    export_cancel: verbs('Cancelling export', 'Cancelled export'),
    exports_list: verbs('Listing exports', 'Listed exports'),
    exports_read: verbs('Checking export', 'Checked export'),
    exports_wait: verbs('Waiting on export', 'Waited on export'),
    delegation_submit: verbs('Submitting work', 'Submitted work'),
    delegation_accept: verbs('Accepting sub-agent work', 'Accepted sub-agent work'),
    delegation_request_revision: verbs('Requesting revision', 'Requested revision'),
    delegation_verify: verbs('Verifying sub-agent work', 'Verified sub-agent work'),
    delegation_reopen: verbs('Reopening delegation', 'Reopened delegation'),
    delegation_cancel: verbs('Cancelling delegation', 'Cancelled delegation'),
    delegations_list: verbs('Listing delegations', 'Listed delegations'),
    delegations_read: verbs('Reading delegation', 'Read delegation'),
    delegations_conflicts: verbs('Checking delegation conflicts', 'Checked delegation conflicts'),
    agent_definitions_list: verbs('Listing agents', 'Listed agents'),
    agent_definitions_search: verbs('Searching agents', 'Searched agents'),
  }),
)

function sessionVerbs(action: string): Verbs | null {
  const known = SESSION_VERBS.get(action)
  if (known) return known
  // The remaining delegation actions (state, claim, dependency, amendments…) all update it.
  if (action.startsWith('delegation_')) return verbs('Updating delegation', 'Updated delegation')
  return null
}

/** The first line of a long objective, cut to fit a row and its accessible name. */
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

/** The sessions tool, which the transcript calls sub-agents. */
export function sessionsLabel(args: JsonObject): ToolLabel {
  const action = stringArg(args, 'action') ?? ''
  if (action === 'wait') {
    const count = arrayLength(args, 'sessionIds')
    const target = count === null ? 'sub-agents' : plural(count, 'sub-agent')
    return {
      running: `Waiting on ${target}...`,
      done: `Waited on ${target}`,
      requested: `Requested ${SUBAGENTS_TITLE}`,
    }
  }
  const known = sessionVerbs(action)
  // An action this list does not know yet keeps its name visible.
  const detail = known
    ? shortDetail(
        stringArg(args, 'title') ?? stringArg(args, 'objective') ?? stringArg(args, 'query'),
      )
    : action || null
  return label(known ?? GENERIC_VERBS, detail, SUBAGENTS_TITLE)
}
