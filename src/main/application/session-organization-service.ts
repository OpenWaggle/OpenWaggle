import { parseJsonUnknown } from '@shared/schema'
import { decodeSessionControlMutationRequest } from '@shared/schemas/session-control'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import type { SessionHostRecoveryResult } from '../ports/session-host-recovery-repository'
import type { SessionOrganizationRequest } from '../ports/session-organization-repository'
import { SessionOrganizationRepository } from '../ports/session-organization-repository'
import {
  type PreparedWorkspaceHandoff,
  SessionWorkspaceHandoffPreparationError,
  SessionWorkspaceHandoffService,
} from '../ports/session-workspace-handoff-service'

const HANDOFF_RECOVERY_RETRY_COUNT = 2
const HANDOFF_RECOVERY_RETRY_DELAY_MS = 25

function classifyPreparationFailure(error: Error) {
  return error instanceof SessionWorkspaceHandoffPreparationError
    ? ({ kind: 'rejected', code: error.code } as const)
    : ({ kind: 'failed', error } as const)
}

function executeExistingWorkspaceHandoff(input: {
  readonly callerId: string
  readonly request: SessionOrganizationRequest & {
    readonly command: Extract<SessionOrganizationRequest['command'], { operation: 'handoff' }>
  }
  readonly preparedHandoff: Extract<PreparedWorkspaceHandoff, { transfer: 'deferred-existing' }>
}) {
  return Effect.gen(function* () {
    const repository = yield* SessionOrganizationRepository
    const handoff = yield* SessionWorkspaceHandoffService
    const admitted = yield* repository.admitExistingHandoff(input).pipe(Effect.either)
    if (admitted._tag === 'Left') {
      yield* handoff.complete(input.preparedHandoff, false)
      return yield* Effect.fail(admitted.left)
    }
    const admission = admitted.right
    if (admission.status === 'completed') {
      yield* handoff.complete(input.preparedHandoff, false)
      return admission.response
    }

    const applied = yield* handoff.apply(input.preparedHandoff).pipe(Effect.either)
    if (applied._tag === 'Left') {
      const rollback = yield* handoff.rollback(input.preparedHandoff).pipe(Effect.either)
      const response = yield* repository.abortExistingHandoff({
        ...input,
        handoff: admission.handoff,
        targetRestored: rollback._tag === 'Right',
      })
      if (rollback._tag === 'Right') yield* handoff.complete(input.preparedHandoff, false)
      return response
    }

    const completed = yield* repository
      .completeExistingHandoff({ ...input, handoff: admission.handoff })
      .pipe(Effect.either)
    if (completed._tag === 'Right') {
      yield* handoff.complete(input.preparedHandoff, true)
      yield* repository.completeHandoffCleanup(input)
      return completed.right
    }

    const rollback = yield* handoff.rollback(input.preparedHandoff).pipe(Effect.either)
    const aborted = yield* repository
      .abortExistingHandoff({
        ...input,
        handoff: admission.handoff,
        targetRestored: rollback._tag === 'Right',
      })
      .pipe(Effect.either)
    if (aborted._tag === 'Left') return yield* Effect.fail(completed.left)
    if (rollback._tag === 'Right') yield* handoff.complete(input.preparedHandoff, false)
    return aborted.right
  })
}

export function organizeSession(input: {
  readonly callerId: string
  readonly request: SessionOrganizationRequest
}) {
  return Effect.gen(function* () {
    const repository = yield* SessionOrganizationRepository
    if (input.request.command.operation !== 'handoff') return yield* repository.execute(input)
    const handoff = yield* SessionWorkspaceHandoffService
    const preparation = yield* handoff
      .prepare({
        callerId: input.callerId,
        request: { ...input.request, command: input.request.command },
      })
      .pipe(Effect.either)
    const failure =
      preparation._tag === 'Left' ? classifyPreparationFailure(preparation.left) : undefined
    if (failure?.kind === 'failed') {
      return yield* Effect.fail(failure.error)
    }
    const preparedHandoff = preparation._tag === 'Right' ? preparation.right : undefined
    const preparationRejectionCode = failure?.kind === 'rejected' ? failure.code : undefined
    if (preparedHandoff?.transfer === 'deferred-existing') {
      return yield* executeExistingWorkspaceHandoff({
        ...input,
        request: { ...input.request, command: input.request.command },
        preparedHandoff,
      })
    }
    const response = yield* repository.execute({
      ...input,
      ...(preparedHandoff ? { preparedHandoff } : {}),
      ...(preparationRejectionCode ? { preparationRejectionCode } : {}),
    })
    if (preparedHandoff) {
      yield* handoff.complete(preparedHandoff, response.outcome.effect === 'session-handed-off')
      if (
        preparedHandoff.transfer === 'release-existing-refs' &&
        response.outcome.effect === 'session-handed-off'
      ) {
        yield* repository.completeHandoffCleanup({
          callerId: input.callerId,
          request: { ...input.request, command: input.request.command },
        })
      }
    }
    return response
  })
}

export function recoverPendingSessionHandoffs(
  pendingHandoffs: SessionHostRecoveryResult['pendingHandoffs'],
) {
  return Effect.forEach(pendingHandoffs, (pending) =>
    recoverPendingHandoff(pending, HANDOFF_RECOVERY_RETRY_COUNT).pipe(Effect.either),
  )
}

function recoverPendingHandoff(
  pending: SessionHostRecoveryResult['pendingHandoffs'][number],
  retriesRemaining: number,
): Effect.Effect<unknown, unknown, SessionOrganizationRepository | SessionWorkspaceHandoffService> {
  const recovery = Effect.gen(function* () {
    const request = yield* Effect.try({
      try: () =>
        decodeSessionControlMutationRequest({
          contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
          requestId: `host-recovery:${pending.operationId}`,
          idempotencyKey: pending.idempotencyKey,
          command: parseJsonUnknown(pending.requestJson),
        }),
      catch: (cause) =>
        new Error(`Pending handoff ${pending.operationId} has an invalid durable request.`, {
          cause,
        }),
    })
    if (request.command.operation !== 'handoff') {
      return yield* Effect.fail(
        new Error(`Pending handoff ${pending.operationId} does not contain a handoff command.`),
      )
    }
    return yield* organizeSession({
      callerId: pending.callerId,
      request: { ...request, command: request.command },
    })
  })
  return recovery.pipe(
    Effect.catchAll((error) =>
      retriesRemaining <= 0
        ? Effect.fail(error)
        : Effect.sleep(HANDOFF_RECOVERY_RETRY_DELAY_MS).pipe(
            Effect.zipRight(recoverPendingHandoff(pending, retriesRemaining - 1)),
          ),
    ),
  )
}
