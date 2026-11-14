import type { SchemaType } from '@shared/schema'
import type {
  sessionDetailCursorSchema,
  sessionWorkspaceRequestSchema,
} from '@shared/schemas/session-data-requests'

export type SessionWorkspaceRequest = SchemaType<typeof sessionWorkspaceRequestSchema>

/** Where a windowed transcript path starts within the whole selected path. */
export interface SessionTranscriptWindow {
  /** Entries of the selected path before the first one returned. */
  readonly startIndex: number
  readonly pathLength: number
}

/**
 * What the caller holds of a Session detail's messages. While the Session's nodes were only
 * appended since `nodeMutationRevision` and the active path still runs through the caller's
 * last message, the detail returns only the messages after it (`messagesDelta`).
 *
 * `messageCount` counts the active path's messages up to and including the caller's last one,
 * also when it holds only the newest of them. With `maxMessages` the detail carries at most that
 * many of the newest messages and says where they start (`messagesWindow`), so a long Session's
 * open moves the transcript's window rather than its whole history (ADR 0036).
 */
export type SessionDetailCursor = SchemaType<typeof sessionDetailCursorSchema>

/** What a cursor read of a Session detail says about the messages it carries. */
export interface SessionDetailReadWindow {
  /** `messages` continues the caller's first `baseMessageCount` ones (a cursor read). */
  readonly messagesDelta?: { readonly baseMessageCount: number }
  /**
   * Present when the read bounded the messages (`SessionDetailCursor.maxMessages`): `messages`
   * starts after `startIndex` of the active path's `pathLength` messages.
   */
  readonly messagesWindow?: SessionTranscriptWindow
}
