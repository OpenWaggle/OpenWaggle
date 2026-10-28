import { getMessageText } from '@shared/types/agent'
import type { SessionNodeId } from '@shared/types/brand'
import type {
  SessionContentTree,
  SessionContentWorkspace,
  SessionDetail,
  SessionNode,
  SessionTranscriptEntry,
  SessionTranscriptNode,
  SessionTree,
  SessionTreeNode,
  SessionWorkspace,
} from '@shared/types/session'
import type {
  SessionDetailCursor,
  SessionWorkspaceRequest,
} from '@shared/types/session-transcript-window'
import { isAgentLoopAuditNode } from './agent-loop-audit-node'

/**
 * What the desktop window reads of a Session (v1 performance, B5/D5).
 *
 * The Host projects every node with its full content. These views bound what crosses the
 * Host → window → renderer hops: the tree carries structure and a short preview, the transcript
 * path carries each message once, and only the newest window of it, and content the caller says
 * it already holds is left out while the Session's nodes were only appended to since.
 */

/** Characters of a node's message text kept for its tree label and the tree filter. */
export const SESSION_TREE_PREVIEW_CHARACTERS = 160

function treeNodeFields(node: SessionNode): SessionTreeNode {
  return {
    id: node.id,
    sessionId: node.sessionId,
    parentId: node.parentId,
    piEntryType: node.piEntryType,
    kind: node.kind,
    ...(node.role === undefined ? {} : { role: node.role }),
    timestampMs: node.timestampMs,
    createdOrder: node.createdOrder,
    pathDepth: node.pathDepth,
    ...(node.branchId === undefined ? {} : { branchId: node.branchId }),
  }
}

function messagePreview(node: SessionNode) {
  if (!node.message) return {}
  const text = getMessageText(node.message).trimStart()
  return {
    hasMessage: true,
    ...(text ? { preview: text.slice(0, SESSION_TREE_PREVIEW_CHARACTERS) } : {}),
  }
}

/** Agent-loop audit nodes keep their content: the transcript places their cards from it. */
function auditContent(node: SessionNode) {
  return isAgentLoopAuditNode(node) ? { contentJson: node.contentJson } : {}
}

export function sessionTreeNodeView(node: SessionNode): SessionTreeNode {
  return { ...treeNodeFields(node), ...messagePreview(node), ...auditContent(node) }
}

export function sessionTreeView(tree: SessionContentTree): SessionTree {
  return { ...tree, nodes: tree.nodes.map(sessionTreeNodeView) }
}

function transcriptNodeView(node: SessionNode): SessionTranscriptNode {
  return {
    ...sessionTreeNodeView(node),
    ...(node.message ? { message: node.message } : {}),
  }
}

/** Where the requested window starts in a path of `pathLength` entries. */
export function transcriptWindowStart(
  path: readonly { readonly node: { readonly id: SessionNodeId } }[],
  window: NonNullable<SessionWorkspaceRequest['window']>,
) {
  const minEntries = Math.max(1, Math.floor(window.minEntries))
  const newestStart = Math.max(0, path.length - minEntries)
  if (!window.includeNodeId) return newestStart
  const includeIndex = path.findIndex((entry) => entry.node.id === window.includeNodeId)
  return includeIndex < 0 ? newestStart : Math.min(newestStart, includeIndex)
}

function reusableNodeIds(request: SessionWorkspaceRequest | undefined, revision: number | null) {
  const cached = request?.cached
  if (!cached || revision === null || cached.nodeMutationRevision !== revision) return null
  return new Set(cached.nodeIds.map(String))
}

function omittedEntry(entry: SessionContentWorkspace['transcriptPath'][number]) {
  return {
    node: sessionTreeNodeView(entry.node),
    ...(entry.branchId === undefined ? {} : { branchId: entry.branchId }),
    isActive: entry.isActive,
    contentOmitted: true,
  } satisfies SessionTranscriptEntry
}

function fullEntry(entry: SessionContentWorkspace['transcriptPath'][number]) {
  return {
    node: transcriptNodeView(entry.node),
    ...(entry.branchId === undefined ? {} : { branchId: entry.branchId }),
    isActive: entry.isActive,
  } satisfies SessionTranscriptEntry
}

/**
 * The workspace as the desktop window reads it. Without a request it holds the whole path (for
 * one-off reads such as a fork's source); with one, the requested window, and entries the caller
 * holds come back without content while the node mutation revision is unchanged.
 */
export function sessionWorkspaceView(
  workspace: SessionContentWorkspace,
  request: SessionWorkspaceRequest | undefined,
  nodeMutationRevision: number | null,
): SessionWorkspace {
  const path = workspace.transcriptPath
  const startIndex = request?.window ? transcriptWindowStart(path, request.window) : 0
  const reusable = reusableNodeIds(request, nodeMutationRevision)
  const transcriptPath = path
    .slice(startIndex)
    .map((entry) => (reusable?.has(String(entry.node.id)) ? omittedEntry(entry) : fullEntry(entry)))
  return {
    tree: sessionTreeView(workspace.tree),
    activeBranchId: workspace.activeBranchId,
    activeNodeId: workspace.activeNodeId,
    ...(workspace.activeBranchState ? { activeBranchState: workspace.activeBranchState } : {}),
    transcriptPath,
    ...(request?.window ? { transcriptWindow: { startIndex, pathLength: path.length } } : {}),
    ...(nodeMutationRevision === null ? {} : { nodeMutationRevision }),
  }
}

function continuesCursor(detail: SessionDetail, cursor: SessionDetailCursor) {
  if (detail.messages.length < cursor.messageCount) return false
  if (cursor.messageCount === 0) return cursor.lastMessageId === null
  const last = detail.messages[cursor.messageCount - 1]
  return last !== undefined && String(last.id) === cursor.lastMessageId
}

/** The newest `maxMessages` of the detail's messages, and where they start. */
function newestMessages(detail: SessionDetail, maxMessages: number | undefined): SessionDetail {
  if (maxMessages === undefined) return detail
  const pathLength = detail.messages.length
  const startIndex = Math.max(0, pathLength - maxMessages)
  return {
    ...detail,
    messages: startIndex === 0 ? detail.messages : detail.messages.slice(startIndex),
    messagesWindow: { startIndex, pathLength },
  }
}

/**
 * A detail read with a cursor: while the node mutation revision is unchanged, nodes were only
 * appended, so the caller's messages are still the start of the active path whenever its last
 * message sits at the same position; only the messages after it are returned. With
 * `maxMessages`, at most that many are returned: more appended messages than that, or a detail
 * that does not continue the caller's, come back as the newest window of the path instead.
 */
export function sessionDetailView(
  detail: SessionDetail | null,
  cursor: SessionDetailCursor | undefined,
  nodeMutationRevision: number | null,
): SessionDetail | null {
  if (!detail) return null
  if (nodeMutationRevision === null) return newestMessages(detail, cursor?.maxMessages)
  const revised = { ...detail, nodeMutationRevision }
  if (
    !cursor ||
    cursor.nodeMutationRevision !== nodeMutationRevision ||
    !continuesCursor(detail, cursor)
  ) {
    return newestMessages(revised, cursor?.maxMessages)
  }
  const appended = detail.messages.slice(cursor.messageCount)
  if (cursor.maxMessages !== undefined && appended.length > cursor.maxMessages) {
    return newestMessages(revised, cursor.maxMessages)
  }
  return {
    ...revised,
    messages: appended,
    messagesDelta: { baseMessageCount: cursor.messageCount },
    ...(cursor.maxMessages === undefined
      ? {}
      : {
          messagesWindow: {
            startIndex: cursor.messageCount,
            pathLength: detail.messages.length,
          },
        }),
  }
}
