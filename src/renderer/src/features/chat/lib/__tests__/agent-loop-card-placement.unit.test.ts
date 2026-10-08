import { OPENWAGGLE_AGENT_LOOP } from '@shared/constants/agent-loop'
import { SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionNode, SessionWorkspace } from '@shared/types/session'
import type { AgentTransportCustomEvent } from '@shared/types/stream'
import { describe, expect, it } from 'vitest'
import {
  type LogEntry,
  sessionDetailFor,
  sessionWorkspaceFor,
} from '../../hooks/__tests__/compaction-marker-transcript.fixtures'
import { buildChatRows } from '../../hooks/useBuildChatRows'
import { readAgentLoopEventsFromWorkspace } from '../agent-loop-transcript-events'
import { sessionToUIMessages } from '../chat-message-conversion'
import { resolveTranscriptMessages } from '../session-workspace-transcript'
import type { AgentInteractionEvent, ChatRow } from '../types-chat-row'

/*
 * Persisted agent-loop cards sit where they happened. A Run's cards are saved as an audit chain
 * hanging from that Run's last entry, and each card follows the last message created before it.
 * They used to stack below the newest answer, so in a compacted Session (ADR 0048) every card from
 * before the compaction showed up at the bottom, below the latest answer.
 *
 * Fixture messages are created at their log position plus one millisecond.
 */

const SESSION_ID = SessionId('cards-session')

type AuditEvent = AgentTransportCustomEvent | AgentInteractionEvent

function auditNode(id: string, parentId: string, event: AuditEvent, order: number): SessionNode {
  return {
    id: SessionNodeId(id),
    sessionId: SESSION_ID,
    parentId: SessionNodeId(parentId),
    piEntryType: 'custom',
    kind: 'custom',
    timestampMs: event.timestamp,
    createdOrder: order,
    pathDepth: order,
    contentJson: JSON.stringify({
      customType: OPENWAGGLE_AGENT_LOOP.SESSION_EVENT_CUSTOM_TYPE,
      event,
    }),
    metadataJson: '{}',
  }
}

/** A Run's audit chain: its first card hangs from the Run's last entry, each next from the last. */
function auditChain(runEnd: string, events: readonly AuditEvent[], firstOrder: number) {
  return events.map((event, index) =>
    auditNode(
      `${runEnd}-audit-${String(index)}`,
      index === 0 ? runEnd : `${runEnd}-audit-${String(index - 1)}`,
      event,
      firstOrder + index,
    ),
  )
}

function notice(name: string, timestamp: number): AgentTransportCustomEvent {
  return { type: 'custom', name, timestamp, value: { note: name } }
}

function confirm(interactionId: string, timestamp: number): AgentInteractionEvent[] {
  return [
    {
      type: 'agent_interaction_request',
      timestamp,
      interaction: {
        interactionId,
        sessionId: SESSION_ID,
        runId: `run-${interactionId}`,
        kind: 'confirm',
        source: 'pi-ui',
        createdAt: timestamp,
        title: 'Continue?',
        message: 'Proceed?',
        purpose: 'user-input',
      },
    },
    {
      type: 'agent_interaction_resolved',
      timestamp: timestamp + 0.1,
      runId: `run-${interactionId}`,
      interactionId,
      kind: 'confirm',
      status: 'resolved',
      response: { kind: 'confirm', accepted: true },
    },
  ]
}

function withAuditNodes(workspace: SessionWorkspace, nodes: readonly SessionNode[]) {
  return { ...workspace, tree: { ...workspace.tree, nodes: [...workspace.tree.nodes, ...nodes] } }
}

/** What the transcript section builds: the workspace path, its persisted cards and their anchors. */
function transcriptRows(log: readonly LogEntry[], audit: (order: number) => SessionNode[]) {
  const workspace = withAuditNodes(sessionWorkspaceFor(SESSION_ID, log, 2), audit(log.length))
  const persisted = readAgentLoopEventsFromWorkspace(workspace)
  const messages = resolveTranscriptMessages({
    activeSessionId: SESSION_ID,
    activeWorkspace: workspace,
    messages: sessionToUIMessages(sessionDetailFor(SESSION_ID, log, 2)),
  })
  return buildChatRows({
    messages,
    customMessages: persisted.customMessages,
    interactionEvents: persisted.interactionEvents,
    agentLoopAnchorMessageIds: persisted.anchorMessageIdByEventKey,
    isLoading: false,
    error: undefined,
    lastUserMessage: null,
    dismissedError: null,
    sessionId: String(SESSION_ID),
    waggleMetadataLookup: {},
    phase: { current: null, completed: [], totalElapsedMs: 0 },
  }).map(rowLabel)
}

function rowLabel(row: ChatRow) {
  if (row.type === 'message') return row.message.id
  if (row.type === 'compaction-summary') return 'marker'
  if (row.type === 'agent-loop-custom-message') return `notice:${row.event.name}`
  if (row.type === 'agent-loop-interaction') {
    return `confirm:${row.item.request.interaction.interactionId}:${row.item.resolution?.status ?? 'open'}`
  }
  return row.type
}

const THREE_TURNS: readonly LogEntry[] = [
  { id: 'user-1', kind: 'user' },
  { id: 'assistant-1', kind: 'assistant' },
  { id: 'user-2', kind: 'user' },
  { id: 'assistant-2', kind: 'assistant' },
  { id: 'user-3', kind: 'user' },
  { id: 'assistant-3', kind: 'assistant' },
]

describe('persisted agent-loop card placement', () => {
  it('keeps the cards of each turn in that turn of an uncompacted Session', () => {
    const rows = transcriptRows(THREE_TURNS, (order) => [
      // Asked while Run 1 worked, before its answer was saved at 2 ms.
      ...auditChain('assistant-1', confirm('first', 1.5), order),
      // A notice after Run 2 answered at 4 ms.
      ...auditChain('assistant-2', [notice('second-run', 4.5)], order + 2),
    ])

    expect(rows).toEqual([
      'user-1',
      'confirm:first:resolved',
      'assistant-1',
      'user-2',
      'assistant-2',
      'notice:second-run',
      'user-3',
      'assistant-3',
    ])
  })

  it('keeps the cards from before a compaction above its marker', () => {
    const log: readonly LogEntry[] = [
      ...THREE_TURNS.slice(0, 4),
      { id: 'compaction-1', kind: 'compaction', firstKeptEntryId: 'user-2' },
      ...THREE_TURNS.slice(4),
    ]
    const rows = transcriptRows(log, (order) => [
      ...auditChain('assistant-1', [notice('before-compaction', 2.5)], order),
      ...auditChain('assistant-2', confirm('also-before', 3.5), order + 1),
      ...auditChain('assistant-3', [notice('after-compaction', 7.5)], order + 3),
    ])

    expect(rows).toEqual([
      'user-1',
      'assistant-1',
      'notice:before-compaction',
      'user-2',
      'confirm:also-before:resolved',
      'assistant-2',
      'marker',
      'user-3',
      'assistant-3',
      'notice:after-compaction',
    ])
  })

  it('never moves a card past the end of the Run that recorded it', () => {
    // A card stamped later than the next Run's messages still belongs to Run 1.
    const rows = transcriptRows(THREE_TURNS, (order) =>
      auditChain('assistant-1', [notice('late-clock', 99)], order),
    )

    expect(rows.indexOf('notice:late-clock')).toBe(rows.indexOf('assistant-1') + 1)
  })
})
