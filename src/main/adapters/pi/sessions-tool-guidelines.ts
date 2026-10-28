import type { SessionCapability } from '@shared/types/session-capability'
import {
  permitsSessionsToolAction,
  type SessionsToolActionGrant,
} from './sessions-tool-capability-schema'

type Permits = (action: string) => boolean

/** Two items join without a list comma. */
const PAIR_LENGTH = 2

/** "a", "a or b", "a, b, or c". */
function either(items: readonly string[]) {
  if (items.length <= PAIR_LENGTH) return items.join(' or ')
  return `${items.slice(0, -1).join(', ')}, or ${items.at(-1)}`
}

function both(items: readonly string[]) {
  if (items.length <= PAIR_LENGTH) return items.join(' and ')
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`
}

function permitted(permits: Permits, actions: readonly string[]) {
  return actions.filter(permits)
}

function rootGuideline(permits: Permits) {
  const launch = permits('launch')
  const create = permits('create')
  if (launch && create) {
    return 'Use launch for an independent root Session that starts immediately, or create for an idle independent root. Neither joins the current Hive.'
  }
  if (launch)
    return 'Use launch for an independent root Session that starts immediately; it does not join the current Hive.'
  if (create)
    return 'Use create for an idle independent root Session; it does not join the current Hive.'
  return undefined
}

function catalogDefaultsGuideline(discovery: readonly string[], permits: Permits) {
  return [
    `${both(discovery)} ${discovery.length === 1 ? 'looks' : 'look'} at your current project by default, every worktree of it included; catalogScope project names another project and catalogScope all every Session you can reach.`,
    permits('list')
      ? 'list leaves archived Sessions out unless archived is true, which lists only archived ones.'
      : '',
    permits('delegations_list')
      ? 'delegations_list shows every state, newest first, unless states narrows it.'
      : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function catalogGuidelines(permits: Permits) {
  const discovery = permitted(permits, ['list', 'search', 'delegations_list'])
  if (discovery.length === 0) return []
  const roots = permitted(permits, ['launch', 'create'])
  const reachActions = permitted(permits, ['read', 'report', 'follow_up'])
  return [
    catalogDefaultsGuideline(discovery, permits),
    [
      'A root Session started from the desktop or from a catalog-wide CLI profile reaches Sessions in every project OpenWaggle knows, without sharing a Hive, when its current Run was started by the desktop user or by an agent with the same reach. Workers and project-scoped callers stay in their own scope and get target_scope_denied for another project.',
      `Use ${either(discovery)} with catalogScope project and that repository projectPath, or catalogScope all${reachActions.length ? `, then ${either(reachActions)} by sessionId` : ''}.`,
      roots.length
        ? `To start work there, pass its projectPath to ${either(roots)} with workspace local or new-worktree; omitted or current uses the checkout of that project.`
        : '',
    ]
      .filter(Boolean)
      .join(' '),
  ]
}

function runControlGuideline(permits: Permits) {
  const uses = [
    ['start', 'start for an idle Session'],
    ['follow_up', 'follow_up for durable work after its current Run'],
    ['steer', 'steer to append to one exact active Run'],
    ['replace', 'replace to interrupt and restart'],
    ['promote', 'promote to move one queued Follow-up into an exact active Run'],
  ].flatMap(([action, use]) => (action && use && permits(action) ? [use] : []))
  return uses.length ? `Use ${both(uses)}.` : undefined
}

function accepts(actions: readonly string[]) {
  return `${both(actions)} accept${actions.length === 1 ? 's' : ''}`
}

function newSessionGuidance(newSession: readonly string[], firstRun: readonly string[]) {
  if (newSession.length === 0) return ''
  const thinking = `${accepts(newSession)} thinking as the new Session's starting level`
  if (firstRun.length === 0) return `${thinking}.`
  if (firstRun.join() === newSession.join())
    return `${thinking} and authorization for its first Run.`
  return `${thinking}; ${accepts(firstRun)} authorization for its first Run.`
}

function thinkingGuideline(permits: Permits) {
  const newSession = permitted(permits, ['create', 'launch', 'spawn'])
  const firstRun = permitted(permits, ['launch', 'spawn'])
  const idle = permitted(permits, ['message', 'start'])
  if (newSession.length === 0 && idle.length === 0) return undefined
  const refused = permitted(permits, ['follow_up', 'steer', 'replace'])
  return [
    "thinking sets a Session's thinking level and authorization applies to one Run.",
    newSessionGuidance(newSession, firstRun),
    idle.length
      ? `${accepts(idle)} both only when the Session is idle and the call starts a Run; thinking then stays the Session's level. Both are refused while a Run is active (${['a message that would be queued', ...refused].join(', ')}), so a Follow-up never carries them.`
      : '',
    "authorization: yolo needs a caller grant that permits that effective access and never changes the Session's mode.",
  ]
    .filter(Boolean)
    .join(' ')
}

function interactionGuideline(permits: Permits) {
  if (!permits('requests_list')) return undefined
  return [
    'Use requests_list to inspect parked interactions.',
    permits('request_respond') ? 'request_respond cannot approve Authorization;' : '',
    permits('approval_respond')
      ? 'approval_respond requires an explicit delegated approval grant.'
      : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function delegationGuideline(permits: Permits) {
  const submits = permits('delegation_submit')
  const reviews = permits('delegation_accept') || permits('delegation_request_revision')
  if (submits && reviews) {
    return 'Workers submit immutable Delegation results; parents request revision or accept an exact submission revision.'
  }
  if (submits)
    return 'Submit immutable Delegation results; your parent requests revision or accepts an exact submission revision.'
  if (reviews)
    return 'Workers submit immutable Delegation results; request revision or accept an exact submission revision.'
  return undefined
}

/** What `nextActor` means, for anyone who reads Session summaries or Delegations (ADR 0059). */
function nextActorGuideline(permits: Permits) {
  if (
    permitted(permits, ['list', 'search', 'read', 'delegations_list', 'delegations_read'])
      .length === 0
  ) {
    return undefined
  }
  return [
    'Every Session summary and Delegation with a Delegation state also carries nextActor, who acts next on that Worker:',
    'user when only the person can unblock it (a parked approval or question, or stuck: it failed or asked for help and its parent has no active Run and nothing queued),',
    'parent when its parent agent acts next (review its result, see its failed Run, or answer its request for help),',
    'worker when it is working or revising, and none once its Delegation is accepted or cancelled.',
    'A Delegation state the Host set for a failed Run clears when a new Run starts; a request for help clears when its parent delivers anything to it.',
  ].join(' ')
}

function cleanupGuideline(permits: Permits) {
  if (!permits('delegation_accept') && !permits('delegation_cancel')) return undefined
  const resuming = permitted(permits, ['start', 'follow_up', 'steer', 'replace'])
  const reviews = permitted(permits, ['delegation_reopen', 'delegation_request_revision'])
  const restorers = [
    ...(resuming.length ? [`Sending ${either(resuming)} to a Worker that cleanup archived`] : []),
    ...(reviews.length
      ? [`${resuming.length ? 'reopening' : 'Reopening'} or requesting revision of its Delegation`]
      : []),
  ]
  return [
    'Cleanup is automatic: once you accept or cancel a Worker and it is idle with nothing queued or parked, the Host archives it on your behalf unless the user ever interacted with it.',
    restorers.length
      ? `${restorers.join(', or ')}${restorers.length > 1 ? ',' : ''} restores it.`
      : '',
    `A Worker archived explicitly stays archived${permits('unarchive') ? '; use unarchive to show it again' : ''}.`,
  ]
    .filter(Boolean)
    .join(' ')
}

function exportGuidelines(permits: Permits) {
  return [
    permits('export')
      ? 'When export returns nextCreatedOrder, continue with afterCreatedOrder and the exact first-page snapshotManifest; never reconstruct or edit that manifest.'
      : undefined,
    permits('export_create')
      ? 'Use export_create for a durable file or bundle export, then exports_wait or exports_read to inspect completion. Export destinations stay inside the current workspace.'
      : undefined,
  ]
}

function sessionsToolGuidelines(permits: Permits) {
  return [
    permits('spawn')
      ? 'Use spawn for a new Worker Session; it never creates an in-memory subagent.'
      : undefined,
    rootGuideline(permits),
    ...catalogGuidelines(permits),
    'Wherever a sessionId, sessionIds, parentSessionId, workerSessionId, or report target takes a Session identity, a Session link the user pasted (openwaggle://sessions/<session-id>) works as it is.',
    runControlGuideline(permits),
    permits('wait') ? WAIT_ESSENTIAL : undefined,
    thinkingGuideline(permits),
    interactionGuideline(permits),
    permits('authorization_set')
      ? 'authorization_set changes a persistent Session boundary and requires its stronger dedicated grant.'
      : undefined,
    permits('report')
      ? 'Use report for provenance-labelled peer context that must not start, steer, or reopen a Run.'
      : undefined,
    delegationGuideline(permits),
    nextActorGuideline(permits),
    cleanupGuideline(permits),
    permits('search') || permits('items')
      ? 'Search before reading broad history, and page transcript items deliberately.'
      : undefined,
    ...exportGuidelines(permits),
    'Discover optional Agent definitions on demand; do not assume named roles exist.',
  ].filter((guideline): guideline is string => guideline !== undefined && guideline !== '')
}

const SCHEDULED_TASK_GUIDELINES = [
  'Create a Scheduled task (schedule_create) only when the user directly asks for recurring or scheduled work, or a project or skill instruction authorizes it. Finish monitoring already in progress within the current Run instead of scheduling it.',
  'A Heartbeat (scheduleKind heartbeat) delivers its prompt into one existing Session, this Session when sessionId is omitted; a Launch schedule (scheduleKind launch) starts a new root Session in projectPath each run. A Heartbeat fires at most every 5 minutes, a Launch schedule every 15.',
  'schedule times (daily at, rrule) are wall-clock times in the task timeZone, the machine zone by default; never convert them to UTC.',
  'Every Heartbeat needs a way to finish: give stopWhen (the outcome after which it stops, in plain words), endsAt or maxRuns; indefinite true only when the user wants it never to end.',
  'When a cheap shell command can tell whether there is anything to do (new CI failures, a changed file), give it as wakeIf: the Host runs it before each firing and skips the Run, with no model call, unless it exits non-zero or prints something on standard output.',
  'A Heartbeat Run reads runCount, consecutiveIdleRuns, stopWhen, remainingRuns and any wakeCheck output in its Run identity. If stopWhen is met or nothing is left to do, call schedule_update enabled:false and state why; end with schedule_outcome done, idle or acted. Idle runs in a row (3 by default, idlePauseAfter) pause it automatically.',
  'A Heartbeat may use its own cheaper model and thinking for its Runs (model, thinking). When a check does not need this Session’s context, a Launch schedule into a fresh Session is often cheaper.',
]

function offersScheduledTasks(capabilities: readonly SessionCapability[] | undefined) {
  return (
    capabilities === undefined ||
    capabilities.includes('schedules:read') ||
    capabilities.includes('schedules:manage')
  )
}

/**
 * Model guidance for the hive tool. Each line names only actions the Session's grant can use, so
 * a Worker is not told about launch, create, start, or unarchive it would be refused.
 */
export function sessionsToolPromptGuidelines(
  capabilities: readonly SessionCapability[] | undefined,
  modelMultiAgentEnabled = true,
) {
  const grant: SessionsToolActionGrant = { capabilities, modelMultiAgentEnabled }
  return [
    ...sessionsToolGuidelines((action) => permitsSessionsToolAction(action, grant)),
    ...(offersScheduledTasks(capabilities) ? SCHEDULED_TASK_GUIDELINES : []),
  ]
}

function collaborationEssential(permits: Permits) {
  const uses = [
    ['report', 'report for peer context that never starts or steers a Run'],
    ['follow_up', "follow_up for work after a Session's current Run"],
    ['steer', 'steer to append to its exact active Run'],
  ].flatMap(([action, use]) => (action && use && permits(action) ? [use] : []))
  return uses.length ? `Use ${both(uses)}.` : undefined
}

function cleanupEssential(permits: Permits) {
  if (!permits('delegation_accept') && !permits('delegation_cancel')) return undefined
  return 'Accepting or cancelling a Worker archives it once idle, unless the user interacted with it; new work restores it.'
}

/** Waking before the provider's five-minute prompt cache expires keeps the next call a cache read. */
const WAIT_ESSENTIAL =
  'Use timeoutMs ≤ 270000 per wait call and wait again if needed, so the prompt cache stays warm.'

const HELP_ESSENTIAL =
  'hive({ action: "help" }) lists every action with its parameters and the full Hive rules (catalog scope, thinking and authorization, nextActor, exports, schedules); read it before an action you have not used.'

/**
 * The Hive rules the system prompt carries on every request: what the tool is, the difference
 * between its collaboration actions, how results are reviewed, and where the rest is. The full set
 * (`sessionsToolPromptGuidelines`) is what `help` returns (C6 of the v1 performance research: the
 * full set was 1.0–1.3k tokens per request). Like the full set, it names only permitted actions.
 */
export function sessionsToolEssentialGuidelines(
  capabilities: readonly SessionCapability[] | undefined,
  modelMultiAgentEnabled = true,
) {
  const grant: SessionsToolActionGrant = { capabilities, modelMultiAgentEnabled }
  const permits: Permits = (action) => permitsSessionsToolAction(action, grant)
  return [
    permits('spawn')
      ? 'Use spawn for a new Worker Session; it never creates an in-memory subagent.'
      : undefined,
    collaborationEssential(permits),
    permits('wait') ? WAIT_ESSENTIAL : undefined,
    delegationGuideline(permits),
    cleanupEssential(permits),
    permits('schedule_create')
      ? 'Create a Scheduled task only when the user asks for recurring or scheduled work, or an instruction authorizes it.'
      : undefined,
    HELP_ESSENTIAL,
  ].filter((guideline): guideline is string => guideline !== undefined)
}
