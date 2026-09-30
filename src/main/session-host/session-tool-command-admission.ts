import type * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import { resolveSessionToolAgentCaller } from './session-tool-agent-caller'
import {
  runSessionToolCallerResolution,
  throwIfSessionToolAborted,
} from './session-tool-gateway-cancellation'
import {
  assertSessionAgentLifecycleProjectKnown,
  normalizeLifecycleProjectPath,
} from './session-tool-project-catalog'

/**
 * Resolve the Session agent calling the Sessions tool and apply the checks that come before
 * dispatch: its live authority, and, for a catalog-wide agent, that a launch or create names a
 * project OpenWaggle already knows (ADR 0041). Returns the caller and the payload to dispatch.
 */
export async function admitSessionToolCommand<Payload extends LocalSessionCommandPayload>(
  sql: SqlClient.SqlClient,
  input: {
    readonly sourceSessionId: string
    readonly sourceRunId: string
    readonly workingDirectory: string
    readonly payload: Payload
    readonly signal?: AbortSignal
  },
) {
  const caller = await runSessionToolCallerResolution(
    resolveSessionToolAgentCaller(sql, {
      sessionId: input.sourceSessionId,
      runId: input.sourceRunId,
      workingDirectory: input.workingDirectory,
    }),
    input.signal,
  )
  throwIfSessionToolAborted(input.signal)
  const payload = normalizeLifecycleProjectPath(input.payload)
  await Effect.runPromise(
    assertSessionAgentLifecycleProjectKnown(sql, caller.profileAuthority.scope, payload),
  )
  return { caller, payload }
}
