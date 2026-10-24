import type * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import { refreshNamedProfileCaller } from '../application/local-session-command-authorization'
import {
  isLocalUserCallerId,
  isProfileCallerId,
  parseSessionAgentCallerId,
} from '../domain/session-control/root-session-project-reach'
import type { ScheduledTaskRecord } from '../ports/scheduled-task-repository'
import { resolveSessionToolAgentCaller } from './session-tool-agent-caller'
import { assertSessionAgentLifecycleProjectKnown } from './session-tool-project-catalog'

export type ScheduledTaskCallerResolution =
  | { readonly live: true; readonly caller: LocalSessionCallerIdentity }
  | { readonly live: false; readonly message: string }

function revoked(message: string): ScheduledTaskCallerResolution {
  return { live: false, message }
}

const SCHEDULING_CAPABILITY = 'schedules:manage'

function profileCaller(callerId: string) {
  return refreshNamedProfileCaller({
    callerId,
    profileAuthority: {
      profileId: callerId.slice('profile:'.length),
      profileName: callerId,
      capabilities: [],
      scope: {},
      authorizationCeiling: 'ask-for-approval',
    },
  }).pipe(
    Effect.map((caller): ScheduledTaskCallerResolution => {
      if (!caller.profileAuthority?.capabilities.includes(SCHEDULING_CAPABILITY)) {
        return revoked('The CLI client profile that created this task can no longer schedule work.')
      }
      return { live: true, caller }
    }),
    Effect.catchAll(() =>
      Effect.succeed(revoked('The CLI client profile that created this task was revoked.')),
    ),
  )
}

function agentCaller(sql: SqlClient.SqlClient, record: ScheduledTaskRecord) {
  const agent = parseSessionAgentCallerId(record.creatorCallerId)
  if (!agent) return Effect.succeed(revoked('The creating agent could not be identified.'))
  return resolveSessionToolAgentCaller(sql, {
    sessionId: agent.sessionId,
    runId: agent.runId,
    workingDirectory: record.creatorWorkingDirectory ?? '',
  }).pipe(
    Effect.map((caller): ScheduledTaskCallerResolution => {
      if (!caller.profileAuthority.capabilities.includes(SCHEDULING_CAPABILITY)) {
        return revoked('The Session agent that created this task can no longer schedule work.')
      }
      return { live: true, caller }
    }),
    Effect.catchAll((error) =>
      Effect.succeed(
        revoked(
          error instanceof Error
            ? `The authority of the Session agent that created this task no longer holds: ${error.message}`
            : 'The authority of the Session agent that created this task no longer holds.',
        ),
      ),
    ),
  )
}

/**
 * The caller a Scheduled task run acts as: the task's creator, with its authority checked again
 * now, as automatic Follow-up delivery checks a queued Follow-up's (ADR 0057). A revoked profile
 * or a Session agent whose authority chain no longer holds stops the task.
 */
export function resolveScheduledTaskCaller(sql: SqlClient.SqlClient, record: ScheduledTaskRecord) {
  const callerId = record.creatorCallerId
  if (isLocalUserCallerId(callerId)) {
    return Effect.succeed<ScheduledTaskCallerResolution>({
      live: true,
      caller: {
        callerId,
        ...(record.creatorWorkingDirectory
          ? { workingDirectory: record.creatorWorkingDirectory }
          : {}),
      },
    })
  }
  if (isProfileCallerId(callerId)) return profileCaller(callerId)
  return agentCaller(sql, record)
}

/**
 * A catalog-wide Session agent may launch only in projects OpenWaggle already knows (ADR 0042);
 * the Hive tool checks this before dispatch, and so does a run the agent scheduled.
 */
export function assertScheduledLaunchProjectKnown(
  sql: SqlClient.SqlClient,
  caller: LocalSessionCallerIdentity,
  payload: LocalSessionCommandPayload,
) {
  if (!parseSessionAgentCallerId(caller.callerId) || !caller.profileAuthority) return Effect.void
  return assertSessionAgentLifecycleProjectKnown(sql, caller.profileAuthority.scope, payload)
}
