import type { SessionId } from '@shared/types/brand'
import { Context, type Effect } from 'effect'
import type { SessionOutputRetryRepositoryError } from '../errors'

interface PendingSessionOutputBase {
  readonly id: string
  readonly sessionId: SessionId
  readonly nodeId: string | null
  readonly branchId: string | null
  readonly createdAt: number
  readonly updatedAt: number
}

export interface PendingCommitSessionOutput extends PendingSessionOutputBase {
  readonly kind: 'commit'
  readonly commitHash: string
  readonly summary: string
}

export interface PendingChangeRequestSessionOutput extends PendingSessionOutputBase {
  readonly kind: 'change-request'
  readonly title: string
  readonly url: string
}

export type PendingSessionOutput = PendingCommitSessionOutput | PendingChangeRequestSessionOutput

export interface SessionOutputRetryRepositoryShape {
  readonly put: (
    output: PendingSessionOutput,
  ) => Effect.Effect<PendingSessionOutput, SessionOutputRetryRepositoryError>
  readonly list: (
    sessionId: SessionId,
  ) => Effect.Effect<readonly PendingSessionOutput[], SessionOutputRetryRepositoryError>
  readonly remove: (
    output: PendingSessionOutput,
  ) => Effect.Effect<void, SessionOutputRetryRepositoryError>
}

export class SessionOutputRetryRepository extends Context.Tag(
  '@openwaggle/SessionOutputRetryRepository',
)<SessionOutputRetryRepository, SessionOutputRetryRepositoryShape>() {}
