import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type { LocalSessionMutationAdmission } from '../application/local-session-mutation-admission'
import { acquireLocalSessionProfileBackgroundWork } from '../application/local-session-profile-background-work'
import { resolveSessionToolAgentCaller } from './session-tool-agent-caller'
import { runSessionToolCallerResolution } from './session-tool-gateway-cancellation'

interface SessionToolAuthorityOriginRow {
  readonly authority_origin_caller_id: string
}

async function originProfileId(sql: SqlClient.SqlClient, sessionId: string) {
  const origins = await Effect.runPromise(
    sql<SessionToolAuthorityOriginRow>`
      SELECT authority_origin_caller_id
      FROM session_execution_profiles
      WHERE session_id = ${sessionId}
      LIMIT 1
    `,
  )
  const callerId = origins[0]?.authority_origin_caller_id
  return callerId?.startsWith('profile:') ? callerId.slice('profile:'.length) : undefined
}

export async function admitSessionToolMutation(input: {
  readonly sql: SqlClient.SqlClient
  readonly sessionId: string
  readonly runId: string
  readonly workingDirectory: string
  readonly signal?: AbortSignal
}): Promise<LocalSessionMutationAdmission> {
  const profileId = await originProfileId(input.sql, input.sessionId)
  const lease = profileId
    ? acquireLocalSessionProfileBackgroundWork(profileId, { cancelOnFence: false })
    : { release: () => undefined }
  if (!lease) throw new Error('Profile authority is changing.')
  try {
    const caller = await runSessionToolCallerResolution(
      resolveSessionToolAgentCaller(input.sql, {
        sessionId: input.sessionId,
        runId: input.runId,
        workingDirectory: input.workingDirectory,
      }),
      input.signal,
    )
    return { caller, release: lease.release }
  } catch (error) {
    lease.release()
    throw error
  }
}
