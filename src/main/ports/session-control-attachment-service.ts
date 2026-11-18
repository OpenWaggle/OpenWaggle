import type { HydratedAttachment, PreparedAttachment } from '@shared/types/agent'
import { Context, type Effect } from 'effect'
import type { AttachmentPreparationEntry } from '../utils/attachment-preparation'

export interface SessionControlAttachmentServiceShape {
  readonly prepare: (input: {
    readonly baseDirectory: string
    readonly entries: readonly AttachmentPreparationEntry[]
    readonly ownerCallerId: string
    readonly requestId: string
    readonly allowedRoots?: readonly string[]
  }) => Effect.Effect<readonly PreparedAttachment[], Error>
  readonly bind: (input: {
    readonly attachmentIds: readonly string[]
    readonly sessionId: string
    readonly ownerCallerId: string
  }) => Effect.Effect<void, Error>
  /** Remove bound blobs that are no longer referenced by an active Run or queued Follow-up. */
  readonly cleanupUnreferenced: (input: {
    readonly sessionId: string
  }) => Effect.Effect<void, Error>
  readonly resolve: (input: {
    readonly attachmentIds: readonly string[]
    readonly sessionId: string
    readonly ownerCallerId: string
  }) => Effect.Effect<readonly HydratedAttachment[], Error>
  readonly release: (input: {
    readonly attachmentIds: readonly string[]
    readonly sessionId: string
    readonly ownerCallerId: string
  }) => Effect.Effect<void, Error>
}

export class SessionControlAttachmentService extends Context.Tag(
  '@openwaggle/SessionControlAttachmentService',
)<SessionControlAttachmentService, SessionControlAttachmentServiceShape>() {}
