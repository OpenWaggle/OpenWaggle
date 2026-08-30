import type { SessionExportManifest } from '@shared/types/session-export'
import type {
  SessionExportCreateCommand,
  SessionExportOperationSummary,
  SessionExportProgress,
} from '@shared/types/session-export-operation'
import { Context, type Effect } from 'effect'
import type { SessionExportOperationRepositoryError } from '../errors'

export interface SessionExportArtifactReceipt {
  readonly sha256: string
  readonly sizeBytes: number
}

export interface SessionExportOperationRecord extends SessionExportOperationSummary {
  readonly callerId: string
  readonly idempotencyKey: string
  readonly temporaryPath: string
  readonly destinationRoot?: string
  readonly resourceSourceRoot?: string
  readonly overwriteExisting: boolean
  readonly cancelRequested: boolean
  readonly cleanupPending: boolean
  readonly artifactReceipt?: SessionExportArtifactReceipt
}

export type SessionExportExecutionClaim =
  | { readonly status: 'claimed'; readonly operation: SessionExportOperationRecord }
  | { readonly status: 'not-claimable'; readonly operation?: SessionExportOperationRecord }

export interface SessionExportOperationRepositoryShape {
  readonly create: (input: {
    readonly callerId: string
    readonly idempotencyKey: string
    readonly command: SessionExportCreateCommand
    readonly resourceSourceRoot?: string
    readonly now: number
  }) => Effect.Effect<
    { readonly operation: SessionExportOperationRecord; readonly replayed: boolean },
    SessionExportOperationRepositoryError
  >
  readonly requestCancellation: (input: {
    readonly sessionId: string
    readonly exportOperationId: string
    readonly now: number
  }) => Effect.Effect<
    { readonly operation: SessionExportOperationRecord; readonly replayed: boolean },
    SessionExportOperationRepositoryError
  >
  readonly read: (
    sessionId: string,
    exportOperationId: string,
  ) => Effect.Effect<SessionExportOperationRecord | null, SessionExportOperationRepositoryError>
  readonly claimExecution: (
    exportOperationId: string,
    now: number,
  ) => Effect.Effect<SessionExportExecutionClaim, SessionExportOperationRepositoryError>
  readonly persistSnapshot: (
    exportOperationId: string,
    manifest: SessionExportManifest,
    now: number,
  ) => Effect.Effect<void, SessionExportOperationRepositoryError>
  readonly persistArtifactPreparation?: (
    exportOperationId: string,
    receipt: SessionExportArtifactReceipt,
    now: number,
  ) => Effect.Effect<void, SessionExportOperationRepositoryError>
  readonly beginArtifactInstallation?: (
    exportOperationId: string,
    now: number,
  ) => Effect.Effect<boolean, SessionExportOperationRepositoryError>
  readonly clearArtifactPreparation?: (
    exportOperationId: string,
    now: number,
  ) => Effect.Effect<void, SessionExportOperationRepositoryError>
  readonly updateProgress: (
    exportOperationId: string,
    progress: SessionExportProgress,
    now: number,
  ) => Effect.Effect<void, SessionExportOperationRepositoryError>
  readonly cancellationRequested: (
    exportOperationId: string,
  ) => Effect.Effect<boolean, SessionExportOperationRepositoryError>
  readonly complete: (
    exportOperationId: string,
    progress: SessionExportProgress,
    now: number,
  ) => Effect.Effect<void, SessionExportOperationRepositoryError>
  readonly fail: (
    exportOperationId: string,
    error: { readonly code: string; readonly message: string },
    now: number,
  ) => Effect.Effect<void, SessionExportOperationRepositoryError>
  readonly cancel: (
    exportOperationId: string,
    now: number,
  ) => Effect.Effect<void, SessionExportOperationRepositoryError>
  readonly completeCleanup: (
    exportOperationId: string,
    now: number,
  ) => Effect.Effect<void, SessionExportOperationRepositoryError>
  readonly listPendingCleanup: Effect.Effect<
    readonly SessionExportOperationRecord[],
    SessionExportOperationRepositoryError
  >
  readonly recoverAfterHostLoss: (
    now: number,
  ) => Effect.Effect<readonly SessionExportOperationRecord[], SessionExportOperationRepositoryError>
}

export class SessionExportOperationRepository extends Context.Tag(
  '@openwaggle/SessionExportOperationRepository',
)<SessionExportOperationRepository, SessionExportOperationRepositoryShape>() {}
