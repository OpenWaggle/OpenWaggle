import type * as SqlClient from '@effect/sql/SqlClient'
import type {
  LocalSessionAuthorityLimits,
  LocalSessionCallerIdentity,
} from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import { localUserWithinLimits } from '../application/local-session-authority-limits'
import { refreshNamedProfileCaller } from '../application/local-session-command-authorization'
import {
  HEARTBEAT_OWNER_REMEDY,
  heartbeatBoundaryRefusal,
  launchNeedsKnownProject,
} from '../application/scheduled-task-authority'
import { sessionAgentAuthorityLimits } from '../application/scheduled-task-principal'
import {
  isLocalUserCallerId,
  isProfileCallerId,
  parseSessionAgentCallerId,
} from '../domain/session-control/root-session-project-reach'
import {
  type ScheduledTaskRecord,
  ScheduledTaskRepository,
} from '../ports/scheduled-task-repository'
import { resolveSessionToolAgentCaller } from './session-tool-agent-caller'
import { assertSessionAgentLifecycleProjectKnown } from './session-tool-project-catalog'

export type ScheduledTaskCallerResolution =
  | {
      readonly live: true
      readonly caller: LocalSessionCallerIdentity
      /** The task as it runs: a task stored naming its creating agent is adopted first. */
      readonly record: ScheduledTaskRecord
    }
  | { readonly live: false; readonly message: string }
  /** The task was deleted while it was being adopted: there is nothing left to run or stop. */
  | { readonly live: false; readonly deleted: true; readonly message: string }

type CallerCheck =
  | { readonly live: true; readonly caller: LocalSessionCallerIdentity }
  | { readonly live: false; readonly message: string }
  /** The task was deleted while it was being adopted: there is nothing left to run or stop. */
  | { readonly live: false; readonly deleted: true; readonly message: string }

function revoked(message: string) {
  return { live: false, message } as const
}

const SCHEDULING_CAPABILITY = 'schedules:manage'

function messageOf(cause: Cause.Cause<unknown>) {
  const failure = Cause.squash(cause)
  return failure instanceof Error ? failure.message : undefined
}

function profileCaller(callerId: string, limits: LocalSessionAuthorityLimits | null) {
  return refreshNamedProfileCaller({
    callerId,
    profileAuthority: {
      profileId: callerId.slice('profile:'.length),
      profileName: callerId,
      capabilities: [],
      scope: {},
      authorizationCeiling: 'ask-for-approval',
    },
    ...(limits ? { authorityLimits: limits } : {}),
  }).pipe(
    Effect.map((caller) => {
      if (!caller.profileAuthority?.capabilities.includes(SCHEDULING_CAPABILITY)) {
        const check: CallerCheck = revoked(
          'The CLI client profile that created this task can no longer schedule work.',
        )
        return check
      }
      const check: CallerCheck = { live: true, caller }
      return check
    }),
    Effect.catchAll(() =>
      Effect.succeed(revoked('The CLI client profile that created this task was revoked.')),
    ),
  )
}

/**
 * The live caller of a task created by a Session agent before tasks ran as the agent's owner.
 * A defect in the authority check (a missing Session row, for one) is read as lost authority, so
 * one such task can never stop the scheduler from checking the others.
 */
function legacyAgentCaller(
  sql: SqlClient.SqlClient,
  record: ScheduledTaskRecord,
  agent: { readonly sessionId: string; readonly runId: string },
) {
  return resolveSessionToolAgentCaller(sql, {
    sessionId: agent.sessionId,
    runId: agent.runId,
    workingDirectory: record.creatorWorkingDirectory ?? '',
  }).pipe(
    Effect.map((caller) => {
      if (!caller.profileAuthority.capabilities.includes(SCHEDULING_CAPABILITY)) {
        const check: CallerCheck = revoked(
          'The Session agent that created this task can no longer schedule work.',
        )
        return check
      }
      const check: CallerCheck = { live: true, caller }
      return check
    }),
    Effect.catchAllCause((cause) => {
      if (Cause.isInterruptedOnly(cause)) return Effect.failCause(cause)
      const message = messageOf(cause)
      return Effect.succeed(
        revoked(
          message
            ? `The authority of the Session agent that created this task no longer holds: ${message}`
            : 'The authority of the Session agent that created this task no longer holds.',
        ),
      )
    }),
  )
}

/**
 * Adopts a task stored naming the Session agent that created it (before ADR 0058's amendment):
 * from now on it runs as the agent's owner within the agent's authority, checked once more here.
 * A creating Session that no longer exists leaves nothing to check, so the task runs as its owner,
 * the local user or CLI client profile whose task it always was. Returns the record to run, or
 * why the agent's authority no longer holds.
 */
function adoptAgentCreatedTask(sql: SqlClient.SqlClient, record: ScheduledTaskRecord) {
  return Effect.gen(function* () {
    const agent = parseSessionAgentCallerId(record.creatorCallerId)
    if (!agent) return record
    const repository = yield* ScheduledTaskRepository
    const origin = yield* repository.sessionAuthorityOrigin(agent.sessionId)
    let authorityLimits: LocalSessionAuthorityLimits | null = null
    if (origin) {
      const check = yield* legacyAgentCaller(sql, record, agent)
      if (!check.live) return check
      authorityLimits = sessionAgentAuthorityLimits(check.caller, origin.originCallerId)
    }
    const adopted = {
      // The owner key is the caller id the task runs as: `local-user` or `profile:<id>`.
      creatorCallerId: record.ownerKey,
      authorityLimits,
      updatedAt: record.updatedAt + 1,
    }
    const stored = yield* repository.update(record.id, record.updatedAt, adopted)
    if (stored) return stored
    // A concurrent edit won: run what is stored now, adopting it on a later tick if still needed.
    const fresh = yield* repository.get(record.id)
    if (!fresh) return { live: false, deleted: true, message: 'This task was deleted.' } as const
    return parseSessionAgentCallerId(fresh.creatorCallerId) ? { ...fresh, ...adopted } : fresh
  })
}

function callerOf(record: ScheduledTaskRecord) {
  const callerId = record.creatorCallerId
  if (isProfileCallerId(callerId)) return profileCaller(callerId, record.authorityLimits)
  if (!isLocalUserCallerId(callerId)) {
    return Effect.succeed<CallerCheck>(revoked('The creator of this task could not be identified.'))
  }
  const caller: LocalSessionCallerIdentity = {
    callerId,
    ...(record.creatorWorkingDirectory ? { workingDirectory: record.creatorWorkingDirectory } : {}),
  }
  return Effect.succeed<CallerCheck>({
    live: true,
    caller: localUserWithinLimits(caller, record.authorityLimits),
  })
}

function heartbeatCheck(record: ScheduledTaskRecord) {
  if (record.target.kind !== 'heartbeat') return Effect.succeed(null)
  return heartbeatBoundaryRefusal({
    ownerCallerId: record.creatorCallerId,
    limits: record.authorityLimits,
    sessionId: record.target.sessionId,
    remedy: HEARTBEAT_OWNER_REMEDY,
  }).pipe(Effect.map((message) => (message ? revoked(message) : null)))
}

/**
 * The caller a Scheduled task run acts as, with its authority checked again now, as automatic
 * Follow-up delivery checks a queued Follow-up's (ADR 0057): the local user, or a CLI client
 * profile while it is not revoked and may still schedule work. A task a Session agent created acts
 * as that owner within the agent's authority at creation, so it does not depend on the agent's
 * Session still existing (ADR 0058).
 */
export function resolveScheduledTaskCaller(sql: SqlClient.SqlClient, stored: ScheduledTaskRecord) {
  return Effect.gen(function* () {
    const record = yield* adoptAgentCreatedTask(sql, stored)
    if ('live' in record) return record
    const resolved = yield* callerOf(record)
    if (!resolved.live) return resolved
    const refusal = yield* heartbeatCheck(record)
    if (refusal) return refusal
    return { live: true, caller: resolved.caller, record } as const
  }).pipe(Effect.map((resolution: ScheduledTaskCallerResolution) => resolution))
}

/**
 * A catalog-wide Session agent may launch only in projects OpenWaggle already knows (ADR 0042);
 * the Hive tool checks this before dispatch, task creation checks it, and so does every run of a
 * Launch schedule an agent created, whoever it now runs as.
 */
export function assertScheduledLaunchProjectKnown(
  sql: SqlClient.SqlClient,
  record: Pick<ScheduledTaskRecord, 'creator'>,
  caller: LocalSessionCallerIdentity,
  payload: LocalSessionCommandPayload,
) {
  const scope = caller.baseProfileScope ?? caller.profileAuthority?.scope
  if (!launchNeedsKnownProject(record.creator, scope)) return Effect.void
  return assertSessionAgentLifecycleProjectKnown(sql, scope ?? { all: true }, payload)
}
