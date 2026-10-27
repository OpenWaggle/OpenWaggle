import type { Message, MessageRole } from './agent'
import type { SessionBranchId, SessionId, SessionNodeId } from './brand'

export type SessionNodeKind =
  | 'user_message'
  | 'assistant_message'
  | 'system_message'
  | 'tool_result'
  | 'custom'
  | 'session_info'
  | 'label'
  | 'model_change'
  | 'thinking_level_change'
  | 'branch_summary'
  | 'compaction_summary'

/**
 * A Session tree node as the desktop window reads it: structure without content.
 *
 * Every node used to carry its full message and raw JSON, so a Session's tree, which lists every
 * node of every branch, moved the whole transcript again on each read (several MB for a long
 * Session). The tree now carries a short `preview` for labels and filtering, and the transcript
 * content travels once, in the workspace's transcript window.
 */
export interface SessionTreeNode {
  readonly id: SessionNodeId
  readonly sessionId: SessionId
  readonly parentId: SessionNodeId | null
  readonly piEntryType: string
  readonly kind: SessionNodeKind
  readonly role?: MessageRole
  readonly timestampMs: number
  readonly createdOrder: number
  readonly pathDepth: number
  readonly branchId?: SessionBranchId | null
  /** The node holds a transcript message; a message's id is its node's id. */
  readonly hasMessage?: boolean
  /** The start of the node's message text (whitespace kept), for labels and the tree filter. */
  readonly preview?: string
  /**
   * Only agent-loop audit nodes keep their content in the tree: the transcript places their
   * cards from it, and they hang off the transcript path rather than on it.
   */
  readonly contentJson?: string
}

/** A transcript-path node: its message travels with it, its raw metadata does not. */
export interface SessionTranscriptNode extends SessionTreeNode {
  readonly message?: Message
}

/** A projected node with its full content, as the Host stores it. */
export interface SessionNode extends SessionTranscriptNode {
  readonly contentJson: string
  readonly metadataJson: string
}
