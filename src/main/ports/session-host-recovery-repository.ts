import { Context, type Effect } from 'effect'
import type { SessionHostRecoveryRepositoryError } from '../errors'

export interface SessionHostRecoveryResult {
  readonly interruptedRunIds: readonly string[]
  readonly affectedSessionIds: readonly string[]
  readonly deniedAuthorizationRequestIds: readonly string[]
  readonly recoveredOperationIds: readonly string[]
  readonly pendingHandoffs: readonly {
    readonly operationId: string
    readonly callerId: string
    readonly idempotencyKey: string
    readonly requestJson: string
  }[]
}

export interface SessionHostRecoveryRepositoryShape {
  readonly recoverAfterHostLoss: (
    now: number,
  ) => Effect.Effect<SessionHostRecoveryResult, SessionHostRecoveryRepositoryError>
}

export class SessionHostRecoveryRepository extends Context.Tag(
  '@openwaggle/SessionHostRecoveryRepository',
)<SessionHostRecoveryRepository, SessionHostRecoveryRepositoryShape>() {}
