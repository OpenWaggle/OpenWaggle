import type { FileHandle } from 'node:fs/promises'
import type { SessionExportManifest, SessionExportNodeRecord } from '@shared/types/session-export'
import { Context, type Effect } from 'effect'
import type { SessionExportArtifactError } from '../errors'
import type {
  SessionExportArtifactReceipt,
  SessionExportOperationRecord,
} from './session-export-operation-repository'

export interface SessionExportArtifactSink {
  readonly writeManifest: (
    manifest: SessionExportManifest,
  ) => Effect.Effect<number, SessionExportArtifactError>
  readonly writeRecords: (
    records: readonly SessionExportNodeRecord[],
  ) => Effect.Effect<number, SessionExportArtifactError>
  readonly writeResource: (input: {
    readonly path: string
    /** Ownership transfers to the sink, which closes the handle on success or failure. */
    readonly sourceHandle: FileHandle
  }) => Effect.Effect<number, SessionExportArtifactError>
  readonly prepareFinalization?: () => Effect.Effect<
    SessionExportArtifactReceipt,
    SessionExportArtifactError
  >
  readonly finalize: () => Effect.Effect<void, SessionExportArtifactError>
  readonly discard: () => Effect.Effect<void, SessionExportArtifactError>
}

export interface SessionExportArtifactWriterShape {
  readonly open: (
    operation: SessionExportOperationRecord,
  ) => Effect.Effect<SessionExportArtifactSink, SessionExportArtifactError>
  readonly discard: (
    operation: SessionExportOperationRecord,
  ) => Effect.Effect<void, SessionExportArtifactError>
  readonly verifyInstalled?: (
    operation: SessionExportOperationRecord,
    receipt: SessionExportArtifactReceipt,
  ) => Effect.Effect<boolean, SessionExportArtifactError>
}

export class SessionExportArtifactWriter extends Context.Tag(
  '@openwaggle/SessionExportArtifactWriter',
)<SessionExportArtifactWriter, SessionExportArtifactWriterShape>() {}
