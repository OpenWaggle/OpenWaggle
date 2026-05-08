import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { WaggleAgentColor } from '@shared/types/waggle'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ChatRow, MessageChatRow } from '../types-chat-row'

vi.mock('@/components/waggle/TurnDivider', () => ({
  TurnDivider: ({
    turnNumber,
    agentLabel,
    agentModel,
  }: {
    turnNumber: number
    agentLabel: string
    agentColor: WaggleAgentColor
    agentModel?: string
  }) => (
    <div data-testid="turn-divider">
      Turn {turnNumber + 1}: {agentLabel}
      {agentModel ? ` · ${agentModel}` : ''}
    </div>
  ),
}))

vi.mock('../MessageBubble', () => ({
  MessageBubble: ({
    message,
    assistantModel,
    waggle,
    hideAgentLabel,
  }: {
    message: UIMessage
    assistantModel?: string
    waggle?: { agentLabel: string }
    hideAgentLabel?: boolean
  }) => (
    <div data-testid="message-bubble">
      <span>{message.id}</span>
      {!hideAgentLabel && (waggle || assistantModel) ? (
        <span data-testid="message-agent-label">
          {waggle?.agentLabel}
          {assistantModel}
        </span>
      ) : null}
    </div>
  ),
}))

import { ChatRowRenderer } from '../ChatRowRenderer'

function assistantMessage(id: string): UIMessage {
  return {
    id,
    role: 'assistant',
    parts: [{ type: 'text', content: id }],
  }
}

function messageRow(message: UIMessage): MessageChatRow {
  return {
    type: 'message',
    message,
    isStreaming: false,
    isRunActive: false,
    showTurnDivider: false,
    assistantModel: SupportedModelId('openai/gpt-5.5'),
    waggle: { agentLabel: 'Architect', agentColor: 'blue' },
    waggleMeta: {
      agentIndex: 0,
      agentLabel: 'Architect',
      agentColor: 'blue',
      agentModel: SupportedModelId('openai/gpt-5.5'),
      turnNumber: 0,
      sessionId: 'session-1',
    },
  }
}

describe('ChatRowRenderer', () => {
  it('shows agent and model once for a grouped waggle turn', () => {
    const row: ChatRow = {
      type: 'waggle-turn',
      id: 'waggle-turn:session-1:0:0:assistant-1',
      agentColor: 'blue',
      turnDividerProps: {
        turnNumber: 0,
        agentLabel: 'Architect',
        agentColor: 'blue',
        agentModel: SupportedModelId('openai/gpt-5.5'),
      },
      messages: [
        messageRow(assistantMessage('assistant-1')),
        messageRow(assistantMessage('tool-1')),
      ],
    }

    render(
      <ChatRowRenderer row={row} sessionId={SessionId('session-1')} onDismissError={vi.fn()} />,
    )

    expect(screen.getByTestId('turn-divider')).toHaveTextContent('Turn 1: Architect')
    expect(screen.getByTestId('turn-divider')).toHaveTextContent('openai/gpt-5.5')
    expect(screen.getAllByTestId('message-bubble')).toHaveLength(2)
    expect(screen.queryByTestId('message-agent-label')).toBeNull()
  })
})
