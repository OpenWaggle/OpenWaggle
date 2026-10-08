import { SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import type { AgentInteractionEvent, ChatRow } from '../../lib/types-chat-row'
import {
  buildChatRows,
  createAssistantPendingToolMessage,
  createToolResultMessage,
  type UIMessage,
  type WaggleMessageMetadata,
} from './useBuildChatRows.test-utils'

/*
 * Live agent-loop cards (not persisted yet, so without an anchor) follow the last message created
 * before them, like persisted ones: a pending approval sits under the tool call that asked for it,
 * not below everything the Run streamed afterwards.
 */

const PHASE = { current: null, completed: [], totalElapsedMs: 0 }

function at<T extends UIMessage>(message: T, createdAt: number): T {
  return { ...message, createdAt: new Date(createdAt) }
}

function text(id: string, role: UIMessage['role'], createdAt: number): UIMessage {
  return { id, role, parts: [{ type: 'text', content: id }], createdAt: new Date(createdAt) }
}

function approval(timestamp: number): AgentInteractionEvent {
  return {
    type: 'agent_interaction_request',
    timestamp,
    interaction: {
      interactionId: 'approval',
      sessionId: SessionId('session-1'),
      runId: 'run-1',
      kind: 'confirm',
      source: 'pi-ui',
      createdAt: timestamp,
      title: 'Run the command?',
      message: 'rm -rf build',
      purpose: 'user-input',
    },
  }
}

function rows(
  messages: UIMessage[],
  options: {
    readonly interactionEvents?: AgentInteractionEvent[]
    readonly waggleMetadataLookup?: Record<string, WaggleMessageMetadata>
    readonly isLoading?: boolean
  },
) {
  return buildChatRows({
    messages,
    interactionEvents: options.interactionEvents ?? [],
    isLoading: options.isLoading ?? false,
    error: undefined,
    lastUserMessage: null,
    dismissedError: null,
    sessionId: 'session-1',
    waggleMetadataLookup: options.waggleMetadataLookup ?? {},
    phase: PHASE,
  })
}

function label(row: ChatRow) {
  if (row.type === 'message') return row.message.id
  if (row.type === 'waggle-turn') return `waggle:${row.messages.map((m) => m.message.id).join('+')}`
  if (row.type === 'agent-loop-interaction') return 'approval'
  return row.type
}

describe('buildChatRows live agent-loop card placement', () => {
  it('keeps a pending approval under the tool call that asked for it while the Run streams on', () => {
    const result = rows(
      [
        text('user-1', 'user', 1),
        at(createAssistantPendingToolMessage('call', 'tool-1', 'Cleaning up'), 2),
        text('later-answer', 'assistant', 4),
      ],
      { interactionEvents: [approval(3)], isLoading: true },
    )

    expect(result.map(label)).toEqual([
      'user-1',
      'call',
      'approval',
      'later-answer',
      'phase-indicator',
    ])
  })

  it('never separates a tool call from the results nested into it', () => {
    const result = rows(
      [
        text('user-1', 'user', 1),
        at(createAssistantPendingToolMessage('call', 'tool-1', 'Cleaning up'), 2),
        at(createToolResultMessage('result', 'tool-1'), 5),
        text('answer', 'assistant', 6),
      ],
      // A Run still active, so its work is not folded away.
      { interactionEvents: [approval(3)], isLoading: true },
    )

    expect(result.map(label)).toEqual(['user-1', 'call', 'approval', 'answer', 'phase-indicator'])
    const call = result[1]
    expect(call?.type === 'message' && call.message.parts.map((part) => part.type)).toEqual([
      'text',
      'tool-call',
      'tool-result',
    ])
  })

  it('places a card inside a Waggle turn after the turn instead of splitting it', () => {
    const meta: WaggleMessageMetadata = {
      agentIndex: 0,
      agentLabel: 'Advocate',
      agentColor: 'blue',
      turnNumber: 0,
    }
    const result = rows(
      [text('user-1', 'user', 1), text('turn-a', 'assistant', 2), text('turn-b', 'assistant', 4)],
      {
        interactionEvents: [approval(3)],
        waggleMetadataLookup: { 'turn-a': meta, 'turn-b': meta },
      },
    )

    expect(result.map(label)).toEqual(['user-1', 'waggle:turn-a+turn-b', 'approval'])
  })

  it('places a card from before every message ahead of them', () => {
    const result = rows([text('user-1', 'user', 5), text('answer', 'assistant', 6)], {
      interactionEvents: [approval(1)],
    })

    expect(result.map(label)).toEqual(['approval', 'user-1', 'answer'])
  })
})
