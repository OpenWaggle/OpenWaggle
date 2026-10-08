import type { Message } from '@shared/types/agent'
import { MessageId, SessionBranchId, type SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionDetail, SessionNode, SessionWorkspace } from '@shared/types/session'
import { buildPiTranscriptPath } from '@shared/utils/session-entry-paths'

/*
 * A Session's Pi log as the Host persists it, and the detail and workspace the renderer reads from
 * it. Both transcripts go through the same transcript path the Host builds, so the messages and the
 * place of a compaction marker here are what the app shows.
 */

function mainBranchId(sessionId: SessionId) {
  return SessionBranchId(`${String(sessionId)}:main`)
}

export interface LogEntry {
  readonly id: string
  readonly kind: 'user' | 'assistant' | 'compaction'
  readonly firstKeptEntryId?: string
  readonly reason?: 'manual' | 'threshold' | 'overflow'
}

function entryMessage(entry: LogEntry, createdOrder: number): Message {
  if (entry.kind === 'compaction') {
    const summary = `Checkpoint ${entry.id}`
    return {
      id: MessageId(entry.id),
      role: 'assistant',
      parts: [{ type: 'text', text: `Compaction summary\n\n${summary}` }],
      createdAt: createdOrder + 1,
      metadata: {
        compactionSummary: { summary, tokensBefore: 4_200, reason: entry.reason ?? 'manual' },
      },
    }
  }
  return {
    id: MessageId(entry.id),
    role: entry.kind,
    parts: [{ type: 'text', text: entry.id }],
    createdAt: createdOrder + 1,
    metadata: { sessionNodeCreatedOrder: createdOrder },
  }
}

function sessionNodes(log: readonly LogEntry[], sessionId: SessionId): SessionNode[] {
  return log.map((entry, index) => ({
    id: SessionNodeId(entry.id),
    sessionId,
    parentId: index === 0 ? null : SessionNodeId(log[index - 1]?.id ?? ''),
    piEntryType: entry.kind === 'compaction' ? 'compaction' : 'message',
    kind:
      entry.kind === 'compaction'
        ? 'compaction_summary'
        : entry.kind === 'user'
          ? 'user_message'
          : 'assistant_message',
    ...(entry.kind === 'compaction' ? {} : { role: entry.kind }),
    timestampMs: index + 1,
    createdOrder: index,
    pathDepth: index,
    branchId: mainBranchId(sessionId),
    message: entryMessage(entry, index),
    contentJson: JSON.stringify(
      entry.kind === 'compaction' ? { firstKeptEntryId: entry.firstKeptEntryId } : {},
    ),
    metadataJson: '{}',
  }))
}

function pathToHead(nodes: readonly SessionNode[]) {
  return buildPiTranscriptPath(String(nodes.at(-1)?.id ?? ''), nodes, {
    getId: (node) => String(node.id),
    getParentId: (node) => (node.parentId ? String(node.parentId) : null),
  })
}

/** `getSessionDetail`: the messages of the transcript path. */
export function sessionDetailFor(
  sessionId: SessionId,
  log: readonly LogEntry[],
  updatedAt: number,
): SessionDetail {
  return {
    id: sessionId,
    title: 'Compacted Session',
    projectPath: '/tmp/project',
    createdAt: 1,
    updatedAt,
    messages: pathToHead(sessionNodes(log, sessionId)).flatMap((node) =>
      node.message ? [node.message] : [],
    ),
  }
}

/** `getSessionWorkspace` at the Session head of the main branch. */
export function sessionWorkspaceFor(
  sessionId: SessionId,
  log: readonly LogEntry[],
  updatedAt: number,
): SessionWorkspace {
  const branchId = mainBranchId(sessionId)
  const nodes = sessionNodes(log, sessionId)
  const head = nodes.at(-1)?.id ?? null
  return {
    tree: {
      session: {
        id: sessionId,
        title: 'Compacted Session',
        projectPath: '/tmp/project',
        createdAt: 1,
        updatedAt,
        lastActiveNodeId: head,
        lastActiveBranchId: branchId,
      },
      nodes,
      branches: [
        {
          id: branchId,
          sessionId,
          sourceNodeId: null,
          headNodeId: head,
          name: 'main',
          isMain: true,
          createdAt: 1,
          updatedAt,
        },
      ],
      branchStates: [],
      uiState: null,
    },
    activeBranchId: branchId,
    activeNodeId: head,
    transcriptPath: pathToHead(nodes).map((node) => ({
      node,
      branchId,
      isActive: node.id === head,
    })),
  }
}
