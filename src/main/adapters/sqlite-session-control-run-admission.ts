import type * as SqlClient from '@effect/sql/SqlClient'
import { sessionHostRefusal } from '@shared/domain/session-host-refusals'
import type { SessionControlMutationCommand } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import type { SessionControlMutationDecision } from '../ports/session-control-repository'
import { hiveWakeRefusal } from './sqlite-hive-wake-admission'
import {
  deliverAfterQueueDecision,
  newRunAdmissionRefusal,
} from './sqlite-session-control-queue-delivery'

/**
 * The decision a mutation may apply once the Run it starts is admitted. A Hive wake re-checks its
 * parent and authority; any other new Run meets the capacity rule (`sqlite-worker-run-admission.ts`),
 * with the mutation's caller as the one acting; and a queue decision delivers its head the same way.
 */
export function admittedMutationDecision(
  sql: SqlClient.SqlClient,
  input: {
    readonly decision: SessionControlMutationDecision
    readonly startsNewRun: boolean
    readonly startsWake: boolean
    readonly callerId: string
    readonly operation: SessionControlMutationCommand['operation']
    readonly idempotencyKey: string
    readonly targetScope: string
    readonly nextRunId: Parameters<typeof deliverAfterQueueDecision>[1]['nextRunId']
    readonly hostRunCeiling: number
  },
) {
  return Effect.gen(function* () {
    const { decision, operation, hostRunCeiling } = input
    if (input.startsNewRun && decision.accepted) {
      const refusal = input.startsWake
        ? yield* hiveWakeRefusal(sql, decision.state, input.callerId, hostRunCeiling)
        : yield* newRunAdmissionRefusal(sql, decision.state, hostRunCeiling, input)
      if (refusal) {
        return {
          accepted: false,
          outcome: {
            operation,
            effect: 'rejected',
            sessionId: input.targetScope,
            ...sessionHostRefusal(refusal),
          },
        } as const
      }
    }
    return yield* deliverAfterQueueDecision(sql, {
      decision,
      operation,
      nextRunId: input.nextRunId,
      hostRunCeiling,
      callerId: input.callerId,
      idempotencyKey: input.idempotencyKey,
    })
  })
}
