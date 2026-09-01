import { SessionId } from '@shared/types/brand'
import type {
  ChatTextPart,
  ChatThinkingPart,
  ChatToolResultPart,
  UIMessage,
} from '@shared/types/chat-ui'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../hooks/useMessageCollapse', () => ({
  useMessageCollapse: () => ({
    canCollapseDetails: false,
    showDetails: false,
    toggleDetails: vi.fn(),
    collapseLabel: '',
    lastRenderableTextPartIndex: -1,
    renderAllParts: true,
  }),
}))

vi.mock('../StreamingText', () => ({
  StreamingText: ({
    text,
    visualizationSessionId,
    visualizationInteractionSessionId,
  }: {
    text: string
    visualizationSessionId?: string
    visualizationInteractionSessionId?: string
  }) => (
    <div
      data-testid="streaming-text"
      data-visualization-session={visualizationSessionId}
      data-visualization-interaction-session={visualizationInteractionSessionId}
    >
      {text}
    </div>
  ),
}))

vi.mock('@/shared/ui/StructuredPayload', () => ({
  StructuredPayload: ({ value }: { value: unknown }) => <div>{JSON.stringify(value)}</div>,
}))

vi.mock('../ToolCallRouter', () => ({
  ToolCallRouter: () => <div data-testid="tool-call-router" />,
}))

vi.mock('../AgentLabel', () => ({ AgentLabel: () => null }))
vi.mock('../CollapsibleDetails', () => ({ CollapsibleDetails: () => null }))

import { AssistantMessageBubble } from '../AssistantMessageBubble'

const currentSessionId = SessionId('session-1')

function renderMessage(message: UIMessage) {
  return render(
    <AssistantMessageBubble
      message={message}
      runtime={{
        sessionId: currentSessionId,
        extensions: { registry: null, projectPaths: [] },
      }}
    />,
  )
}

function textPart(content: string): ChatTextPart {
  return { type: 'text', content }
}

function toolResultPart(toolCallId: string): ChatToolResultPart {
  return { type: 'tool-result', toolCallId, content: 'ok', state: 'output-available' }
}

function thinkingPart(): ChatThinkingPart {
  return { type: 'thinking', content: 'internal reasoning' }
}

describe('AssistantMessageBubble visualization ownership', () => {
  it('uses persisted visualization ownership for a copied assistant message', () => {
    renderMessage({
      id: 'message-1',
      role: 'assistant',
      parts: [textPart('Copied visualization')],
      metadata: { visualizationSessionId: SessionId('source-session') },
    })

    expect(screen.getByTestId('streaming-text')).toHaveAttribute(
      'data-visualization-session',
      'source-session',
    )
    expect(screen.getByTestId('streaming-text')).toHaveAttribute(
      'data-visualization-interaction-session',
      currentSessionId,
    )
  })

  it('grants visualization ownership only to assistant-authored text', () => {
    renderMessage({
      id: 'message-1',
      role: 'assistant',
      parts: [textPart('Hello'), toolResultPart('tool-1'), thinkingPart()],
    })

    const streamedParts = screen.getAllByTestId('streaming-text')
    expect(streamedParts[0]).toHaveAttribute('data-visualization-session', currentSessionId)
    expect(streamedParts[1]).not.toHaveAttribute('data-visualization-session')
    expect(streamedParts[2]).not.toHaveAttribute('data-visualization-session')
  })
})
