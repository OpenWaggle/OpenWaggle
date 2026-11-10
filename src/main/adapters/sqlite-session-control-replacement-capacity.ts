import type * as SqlClient from '@effect/sql/SqlClient'
import { sessionHostRefusal } from '@shared/domain/session-host-refusals'
import type { SessionControlMutationOutcome } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import type { SessionControlOperationJournalShape } from '../ports/session-control-operation-journal'
import { workerRunAdmissionRefusal } from './sqlite-worker-run-admission'

/** A claimed replacement whose Run would be agents' work past a full Worker limit. */
function replacementCapacityRejection(
  sql: SqlClient.SqlClient,
  input: Parameters<SessionControlOperationJournalShape['claim']>[0],
  sessionId: string,
) {
  return Effect.gen(function* () {
    if (!input.replacementRun) return undefined
    const { caller, hostRunCeiling } = input.replacementRun
    const code = yield* workerRunAdmissionRefusal(sql, {
      sessionId,
      runCaller: caller,
      requestCaller: caller,
      hostRunCeiling,
    })
    if (!code) return undefined
    return {
      operation: input.request.command.operation,
      effect: 'rejected',
      sessionId,
      ...sessionHostRefusal(code),
    } satisfies SessionControlMutationOutcome
  })
}

/**
 * The claim's decision, or its refusal when it is an agent's replacement past a full Worker
 * limit. Capacity is checked only for a claim that is otherwise valid, so a stale request gets its
 * own code, not a retryable capacity one.
 */
export function withReplacementCapacity<Decision extends { readonly accepted: boolean }>(
  sql: SqlClient.SqlClient,
  input: Parameters<SessionControlOperationJournalShape['claim']>[0],
  sessionId: string,
  decided: Decision,
) {
  return Effect.gen(function* () {
    if (!decided.accepted) return decided
    const outcome = yield* replacementCapacityRejection(sql, input, sessionId)
    return outcome ? ({ accepted: false, outcome } as const) : decided
  })
}
