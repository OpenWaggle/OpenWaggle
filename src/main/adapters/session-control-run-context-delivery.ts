import * as Effect from 'effect/Effect'
import * as Schedule from 'effect/Schedule'
import { createLogger } from '../logger'
import type { SessionControlRunExecutionInput } from '../ports/session-control-run-executor'
import type { SessionOrchestrationUpdateRepository } from '../ports/session-orchestration-update-repository'
import type { SessionReportRepositoryShape } from '../ports/session-report-repository'
import {
  publishSessionHostEvent,
  tryGetSessionHostEventRuntime,
} from '../session-host/session-host-events'

type RunIdentity = Pick<SessionControlRunExecutionInput, 'sessionId' | 'runId'>

const logger = createLogger('session-control/context-delivery')
const DELIVERY_ACKNOWLEDGEMENT_RETRY_COUNT = 2

function publishDelivered(input: RunIdentity) {
  publishSessionHostEvent({
    kind: 'session-list-changed',
    sessionId: input.sessionId,
    change: 'updated',
  })
}

function superviseDeliveryAcknowledgement(
  input: RunIdentity,
  kind: string,
  acknowledgement: Effect.Effect<void, unknown>,
) {
  const runtime = tryGetSessionHostEventRuntime()
  let releaseLiveness: () => void = () => undefined
  try {
    releaseLiveness = runtime?.liveness.acquire('follow-up-delivery') ?? releaseLiveness
  } catch (error) {
    logger.error('Could not reserve Session Host liveness for a delivery acknowledgement.', {
      error: String(error),
      kind,
      runId: input.runId,
      sessionId: input.sessionId,
    })
  }
  Effect.runFork(
    acknowledgement.pipe(
      Effect.retry(Schedule.recurs(DELIVERY_ACKNOWLEDGEMENT_RETRY_COUNT)),
      Effect.tap(() => Effect.sync(() => publishDelivered(input))),
      Effect.catchAllCause((cause) =>
        Effect.sync(() => {
          logger.error('Durable context delivery acknowledgement exhausted retries.', {
            cause: String(cause),
            kind,
            runId: input.runId,
            sessionId: input.sessionId,
          })
          runtime?.liveness.requestDrain()
        }),
      ),
      Effect.ensuring(Effect.sync(releaseLiveness)),
    ),
  )
}

export function markReportsDelivered(
  reports: SessionReportRepositoryShape,
  input: RunIdentity,
  reportIds: readonly string[],
) {
  superviseDeliveryAcknowledgement(
    input,
    'report',
    reports.markDelivered({
      reportIds,
      targetSessionId: input.sessionId,
      runId: input.runId,
      itemIds: reportIds.map((reportId) => `peer-report:${input.runId}:${reportId}`),
      deliveredAt: Date.now(),
    }),
  )
}

export function markOrchestrationUpdatesDelivered(
  updates: SessionOrchestrationUpdateRepository['Type'],
  input: RunIdentity,
  updateIds: readonly string[],
) {
  superviseDeliveryAcknowledgement(
    input,
    'orchestration-update',
    updates.markDelivered({
      updateIds,
      parentSessionId: input.sessionId,
      runId: input.runId,
      itemIds: updateIds.map((updateId) => `orchestration:${input.runId}:${updateId}`),
      deliveredAt: Date.now(),
    }),
  )
}

export function markSpecificationUpdatesDelivered(
  updates: SessionOrchestrationUpdateRepository['Type'],
  input: RunIdentity,
  updateIds: readonly string[],
) {
  superviseDeliveryAcknowledgement(
    input,
    'delegation-specification',
    updates.markSpecificationsDelivered({
      updateIds,
      workerSessionId: input.sessionId,
      runId: input.runId,
      itemIds: updateIds.map((updateId) => `delegation-specification:${input.runId}:${updateId}`),
      deliveredAt: Date.now(),
    }),
  )
}
