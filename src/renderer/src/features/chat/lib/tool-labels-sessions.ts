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

const SESSION_VERBS: ReadonlyMap<string, Verbs> = new Map(
  Object.entries({
    spawn: { running: 'Spawning sub-agent', done: 'Spawned sub-agent' },
    launch: { running: 'Launching session', done: 'Launched session' },
    create: { running: 'Creating session', done: 'Created session' },
    fork: { running: 'Forking session', done: 'Forked session' },
    message: { running: 'Messaging sub-agent', done: 'Messaged sub-agent' },
    start: { running: 'Starting sub-agent', done: 'Started sub-agent' },
    follow_up: { running: 'Sending follow-up', done: 'Sent follow-up' },
    steer: { running: 'Steering sub-agent', done: 'Steered sub-agent' },
    replace: { running: 'Restarting sub-agent', done: 'Restarted sub-agent' },
    promote: { running: 'Promoting follow-up', done: 'Promoted follow-up' },
    interrupt: { running: 'Interrupting sub-agent', done: 'Interrupted sub-agent' },
    interrupt_descendants: { running: 'Interrupting sub-agents', done: 'Interrupted sub-agents' },
    report: { running: 'Sending report', done: 'Sent report' },
    handoff: { running: 'Handing off session', done: 'Handed off session' },
    rename: { running: 'Renaming session', done: 'Renamed session' },
    archive: { running: 'Archiving session', done: 'Archived session' },
    unarchive: { running: 'Restoring session', done: 'Restored session' },
    list: { running: 'Listing sessions', done: 'Listed sessions' },
    search: { running: 'Searching sessions', done: 'Searched sessions' },
    read: { running: 'Reading session', done: 'Read session' },
    status: { running: 'Checking session', done: 'Checked session' },
    turns: { running: 'Reading session', done: 'Read session' },
    items: { running: 'Reading session', done: 'Read session' },
    delegation_submit: { running: 'Submitting work', done: 'Submitted work' },
    delegation_accept: { running: 'Accepting sub-agent work', done: 'Accepted sub-agent work' },
    delegation_request_revision: { running: 'Requesting revision', done: 'Requested revision' },
    delegation_verify: { running: 'Verifying sub-agent work', done: 'Verified sub-agent work' },
    delegation_cancel: { running: 'Cancelling delegation', done: 'Cancelled delegation' },
    agent_definitions_list: { running: 'Listing agents', done: 'Listed agents' },
    agent_definitions_search: { running: 'Searching agents', done: 'Searched agents' },
  }),
)

function sessionVerbs(action: string): Verbs {
  const known = SESSION_VERBS.get(action)
  if (known) return known
  if (action === 'wait') return { running: 'Waiting on sub-agents', done: 'Waited on sub-agents' }
  if (action.startsWith('delegations_')) {
    return { running: 'Reading delegations', done: 'Read delegations' }
  }
  if (action.startsWith('delegation_')) {
    return { running: 'Updating delegation', done: 'Updated delegation' }
  }
  if (action.startsWith('queue_') || action === 'requests_list') {
    return { running: 'Reading session queue', done: 'Read session queue' }
  }
  if (action.startsWith('export')) return { running: 'Exporting session', done: 'Exported session' }
  return { running: 'Sub-agents', done: 'Sub-agents' }
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
  const verbs = sessionVerbs(action)
  const detail =
    stringArg(args, 'title') ??
    stringArg(args, 'objective') ??
    stringArg(args, 'query') ??
    (verbs.done === 'Sub-agents' && action ? action : null)
  return label(verbs, detail, SUBAGENTS_TITLE)
}
