import { type SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionWorkspace } from '@shared/types/session'
import { buildPiTranscriptPath } from '@shared/utils/session-entry-paths'

/**
 * Transcript history the Host still holds above the loaded window (ADR 0036, v1 performance B5).
 *
 * The window reads only the newest part of a long Session's path. When the reader reaches the top
 * of the loaded rows, or a saved reading position names a row older than them, the viewport asks
 * for more through this.
 */
export interface TranscriptRemoteHistory {
  readonly hasEarlier: boolean
  readonly loadEarlier: () => void
  /** Reads the window back to the Session node a saved reading position anchors on. */
  readonly loadThrough: (nodeId: string) => void
}

const NODE_ROW_KEY_PREFIXES = ['message:', 'turn-fold:', 'compaction:', 'branch-summary:'] as const

/**
 * The Session node a row key names, when it names one: message rows are keyed by their message
 * id, which is their node id once persisted, and so are the fold, compaction and branch-summary
 * rows of a node. A repeated key's `#n` occurrence suffix is dropped.
 */
export function rowKeyNodeId(rowKey: string): string | null {
  const key = rowKey.replace(/#\d+$/u, '')
  const prefix = NODE_ROW_KEY_PREFIXES.find((candidate) => key.startsWith(candidate))
  if (!prefix) return null
  const nodeId = key.slice(prefix.length)
  return nodeId.length > 0 ? nodeId : null
}

const pathNodeIdsByWorkspace = new WeakMap<SessionWorkspace, readonly string[]>()

/**
 * Every node id of the displayed path, from the tree's structure: the workspace holds only the
 * newest window of the path (ADR 0036, B5). Built once per loaded workspace, not per render.
 */
export function workspacePathNodeIds(workspace: SessionWorkspace): readonly string[] {
  const cached = pathNodeIdsByWorkspace.get(workspace)
  if (cached) return cached
  const ids =
    (workspace.transcriptWindow?.startIndex ?? 0) > 0 && workspace.activeNodeId
      ? buildPiTranscriptPath(String(workspace.activeNodeId), workspace.tree.nodes, {
          getId: (node) => String(node.id),
          getParentId: (node) => (node.parentId ? String(node.parentId) : null),
        }).map((node) => String(node.id))
      : workspace.transcriptPath.map(({ node }) => String(node.id))
  pathNodeIdsByWorkspace.set(workspace, ids)
  return ids
}

/** The loaded transcript window's older history on the Host, when it has any (ADR 0036, B5). */
export function remoteTranscriptHistory(input: {
  readonly workspace: SessionWorkspace | null
  readonly sessionId: SessionId | null
  readonly loadEarlier: (sessionId: SessionId) => Promise<void>
  readonly loadThrough: (sessionId: SessionId, nodeId: SessionNodeId) => Promise<void>
}): TranscriptRemoteHistory | null {
  const { workspace, sessionId } = input
  if (!workspace || !sessionId || workspace.tree.session.id !== sessionId) return null
  if ((workspace.transcriptWindow?.startIndex ?? 0) === 0) return null
  return {
    hasEarlier: true,
    loadEarlier: () => void input.loadEarlier(sessionId),
    loadThrough: (nodeId) => void input.loadThrough(sessionId, SessionNodeId(nodeId)),
  }
}
