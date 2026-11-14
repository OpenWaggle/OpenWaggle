import type { SessionCapability } from '@shared/types/session-capability'
import {
  permitsSessionsToolAction,
  type SessionsToolActionGrant,
} from './sessions-tool-capability-schema'
import { REVISION_STARTS_WORKER_RUN, revisionGuideline } from './sessions-tool-revision-guidelines'
import { SCHEDULED_TASK_GUIDELINES } from './sessions-tool-schedule-guidelines'
import { SELF_ARCHIVE_GUIDELINE } from './sessions-tool-self-archive-guideline'

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
  if (launch) {
    return 'Use launch for an independent root Session that starts immediately; it does not join the current Hive.'
  }
  if (create) {
    return 'Use create for an idle independent root Session; it does not join the current Hive.'
  }
  return undefined
}

/**
 * Agent definitions are named roles a new Session can run with. The guideline used to say only
 * "discover them on demand; do not assume named roles exist", which agents read as "skip them":
 * they wrote each role into the objective by hand next to a definition made for it.
 */
function agentDefinitionGuideline(permits: Permits) {
  const starts = permitted(permits, ['spawn', 'launch', 'create'])
  if (starts.length === 0) {
    return 'agent_definitions_list and agent_definitions_search show Agent definitions by name and description.'
  }
  // Another project's catalog is read only by a Session that can start a Session there and list
  // its Sessions, as agentDefinitionProjectForTool requires.
  const readsOtherProjects = (permits('launch') || permits('create')) && permits('list')
  const otherProject = readsOtherProjects ? ' (projectPath for another project)' : ''
  return `When an Agent definition fits a role, ${either(starts)} with agent: "<name>" and give it only the task, not the role; available_agents lists the project's, and agent_definitions_list and agent_definitions_search find them${otherProject}. Never pass a name that no list shows.`
}

/** fullTranscript also needs sessions:read, so a discover-only grant is not told to use it. */
function archivedSearchGuideline(readsTranscripts: boolean) {
  return `search leaves archived Sessions out unless includeArchived is true; when a Session the user names is missing, search again with includeArchived${readsTranscripts ? ' and fullTranscript' : ''}, and catalogScope all if it may be in another project. A later page's cursor needs the same options.`
}

function catalogDefaultsGuideline(discovery: readonly string[], permits: Permits) {
  return [
    `${both(discovery)} ${discovery.length === 1 ? 'looks' : 'look'} at your current project by default, every worktree of it included; catalogScope project names another project and catalogScope all every Session you can reach.`,
    permits('list')
      ? 'list leaves archived Sessions out unless archived is true, which lists only archived ones.'
      : '',
    permits('search') ? archivedSearchGuideline(permits('read')) : '',
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
  if (firstRun.join() === newSession.join()) {
    return `${thinking} and authorization for its first Run.`
  }
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

/** A parent need not stay in a Run to hear from its Workers (Hive wake, ADR 0030 amendment). */
const IDLE_PARENT_WAKE =
  'A Worker result or help request that arrives while you are idle starts a Run for you.'

function delegationGuideline(permits: Permits) {
  const submits = permits('delegation_submit')
  const reviews = permits('delegation_accept') || permits('delegation_request_revision')
  if (submits && reviews) {
    return `Workers submit immutable Delegation results; parents request revision ${REVISION_STARTS_WORKER_RUN} or accept an exact submission revision. ${IDLE_PARENT_WAKE}`
  }
  if (submits) {
    return 'Submit immutable Delegation results; your parent requests revision or accepts an exact submission revision.'
  }
  if (reviews) {
    return `Workers submit immutable Delegation results; request revision ${REVISION_STARTS_WORKER_RUN} or accept an exact submission revision. ${IDLE_PARENT_WAKE}`
  }
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
    permits('status')
      ? 'status queueState running means the Follow-up queue is not paused, not that a Run is active; activeRunId null means the Session is idle.'
      : undefined,
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
    revisionGuideline(permits),
    nextActorGuideline(permits),
    cleanupGuideline(permits),
    permits('archive') ? SELF_ARCHIVE_GUIDELINE : undefined,
    permits('search') || permits('items')
      ? 'Search before reading broad history, and page transcript items deliberately.'
      : undefined,
    ...exportGuidelines(permits),
    agentDefinitionGuideline(permits),
  ].filter((guideline): guideline is string => guideline !== undefined && guideline !== '')
}

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
