import type { SessionCapability } from '@shared/types/session-capability'

const SESSIONS_TOOL_GUIDELINES = [
  'Use spawn for a new Worker Session; it never creates an in-memory subagent.',
  'Use launch for an independent root Session that starts immediately, or create for an idle independent root. Neither joins the current Hive.',
  'A root Session started from the desktop or from a catalog-wide CLI profile reaches Sessions in every project OpenWaggle knows, without sharing a Hive, when its current Run was started by the desktop user or by an agent with the same reach. Workers and project-scoped callers stay in their own scope and get target_scope_denied. Use list or search with catalogScope project and that repository projectPath, or catalogScope all, then read, report, or follow_up by sessionId. To start work there, pass its projectPath to launch or create with workspace local or new-worktree; omitted or current uses the checkout of that project.',
  'Wherever a sessionId, sessionIds, parentSessionId, workerSessionId, or report target takes a Session identity, a Session link the user pasted (openwaggle://sessions/<session-id>) works as it is.',
  'Use start for an idle Session, follow_up for durable work after its current Run, steer to append to one exact active Run, replace to interrupt and restart, and promote to move one queued Follow-up into an exact active Run.',
  "thinking sets a Session's thinking level and authorization applies to one Run. create, launch, and spawn accept thinking as the new Session's starting level; launch and spawn accept authorization for its first Run. message and start accept both only when the Session is idle and the call starts a Run; thinking then stays the Session's level. Both are refused while a Run is active (a message that would be queued, follow_up, steer, replace), so a Follow-up never carries them. authorization: yolo needs a caller grant that permits that effective access and never changes the Session's mode.",
  'Use requests_list to inspect parked interactions. request_respond cannot approve Authorization; approval_respond requires an explicit delegated approval grant.',
  'authorization_set changes a persistent Session boundary and requires its stronger dedicated grant.',
  'Use report for provenance-labelled peer context that must not start, steer, or reopen a Run.',
  'Workers submit immutable Delegation results; parents request revision or accept an exact submission revision.',
  'Cleanup is automatic: once you accept or cancel a Worker and it is idle with nothing queued or parked, the Host archives it on your behalf unless the user ever interacted with it. Sending start, follow_up, steer, or replace to a Worker that cleanup archived, or reopening or requesting revision of its Delegation, restores it. A Worker archived explicitly stays archived; use unarchive to show it again.',
  'Search before reading broad history, and page transcript items deliberately.',
  'When export returns nextCreatedOrder, continue with afterCreatedOrder and the exact first-page snapshotManifest; never reconstruct or edit that manifest.',
  'Use export_create for a durable file or bundle export, then exports_wait or exports_read to inspect completion. Export destinations stay inside the current workspace.',
  'Discover optional Agent definitions on demand; do not assume named roles exist.',
]

const SCHEDULED_TASK_GUIDELINES = [
  'Create a Scheduled task (schedule_create) only when the user directly asks for recurring or scheduled work, or a project or skill instruction authorizes it. Finish monitoring already in progress within the current Run instead of scheduling it.',
  'A Heartbeat (scheduleKind heartbeat) delivers its prompt into one existing Session, this Session when sessionId is omitted; a Launch schedule (scheduleKind launch) starts a new root Session in projectPath each run. A Heartbeat fires at most every 5 minutes, a Launch schedule every 15.',
  'schedule times (daily at, rrule) are wall-clock times in the task timeZone, the machine zone by default; never convert them to UTC.',
  'When the outcome a Heartbeat monitors is reached, pause it with schedule_update enabled false.',
]

function offersScheduledTasks(capabilities: readonly SessionCapability[] | undefined) {
  return (
    capabilities === undefined ||
    capabilities.includes('schedules:read') ||
    capabilities.includes('schedules:manage')
  )
}

/** Model guidance for the hive tool; Scheduled task guidance only where it can be used. */
export function sessionsToolPromptGuidelines(
  capabilities: readonly SessionCapability[] | undefined,
) {
  return [
    ...SESSIONS_TOOL_GUIDELINES,
    ...(offersScheduledTasks(capabilities) ? SCHEDULED_TASK_GUIDELINES : []),
  ]
}
