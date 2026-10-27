import type { SessionNodeId } from './brand'

/**
 * Which part of the selected path a workspace read returns (ADR 0036 bounds the transferred
 * rows as well as the mounted ones). The window is always a suffix of the path: it ends at the
 * selected node and holds at least `minEntries` entries, and also `includeNodeId` when that node
 * is on the path, so a restored reading position deep in history is in it.
 */
export interface SessionTranscriptWindowRequest {
  readonly minEntries: number
  readonly includeNodeId?: SessionNodeId | null
}

export interface SessionWorkspaceRequest {
  readonly window?: SessionTranscriptWindowRequest
  /**
   * Nodes the caller already holds, read at `nodeMutationRevision`. While the Session's nodes
   * were only appended since, their entries come back without content (`contentOmitted`).
   */
  readonly cached?: {
    readonly nodeMutationRevision: number
    readonly nodeIds: readonly SessionNodeId[]
  }
}

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
export interface SessionDetailCursor {
  readonly nodeMutationRevision: number
  readonly messageCount: number
  readonly lastMessageId: string | null
  readonly maxMessages?: number
}

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
