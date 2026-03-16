import { ConversationId, SupportedModelId } from '@shared/types/brand'
import type { UIMessage } from '@tanstack/ai-react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UseMessageCollapseResult } from '../hooks/useMessageCollapse'

type MessagePart = UIMessage['parts'][number]

// ---------------------------------------------------------------------------
// Hoisted mock handles
// ---------------------------------------------------------------------------
const mockCollapse = vi.hoisted(() => ({
  current: {
    canCollapseToSynthesis: false,
    showDetails: false,
    toggleDetails: vi.fn(),
    collapseLabel: '',
    lastRenderableTextPartIndex: -1,
    renderAllParts: true,
  } satisfies UseMessageCollapseResult,
}))

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock('../hooks/useMessageCollapse', () => ({
  useMessageCollapse: () => mockCollapse.current,
}))

vi.mock('../StreamingText', () => ({
  StreamingText: ({ text }: { text: string }) => <div data-testid="streaming-text">{text}</div>,
}))

vi.mock('../ToolCallRouter', () => ({
  ToolCallRouter: ({ part }: { part: { name: string } }) => (
    <div data-testid="tool-call-router">{part.name}</div>
  ),
}))

vi.mock('../AgentLabel', () => ({
  AgentLabel: ({
    assistantModel,
    waggle,
  }: {
    assistantModel?: string
    waggle?: { agentLabel: string }
  }) => {
    if (!assistantModel && !waggle) return null
    return (
      <div data-testid="agent-label">
        {waggle?.agentLabel}
        {assistantModel}
      </div>
    )
  },
}))

vi.mock('../CollapsibleDetails', () => ({
  CollapsibleDetails: ({
    collapseLabel,
  }: {
    collapseLabel: string
    showDetails: boolean
    onToggle: () => void
  }) => <div data-testid="collapsible-details">{collapseLabel}</div>,
}))

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------
import { AssistantMessageBubble } from '../AssistantMessageBubble'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function textPart(content: string): MessagePart {
  return { type: 'text', content }
}

function toolCallPart(name: string, id = 'tc-1'): MessagePart {
  return { type: 'tool-call', id, name, arguments: '{}', state: 'output-available' }
}

function toolResultPart(toolCallId: string): MessagePart {
  return {
    type: 'tool-result',
    toolCallId,
    content: 'ok',
    state: 'output-available',
  }
}

function thinkingPart(): MessagePart {
  return { type: 'thinking', content: 'internal reasoning' }
}

function createMessage(id: string, parts: MessagePart[]): UIMessage {
  return { id, role: 'assistant', parts }
}

const defaultConversationId = ConversationId('conv-1')

function setCollapse(overrides: Partial<UseMessageCollapseResult>) {
  mockCollapse.current = { ...mockCollapse.current, ...overrides }
}

function resetCollapse() {
  mockCollapse.current = {
    canCollapseToSynthesis: false,
    showDetails: false,
    toggleDetails: vi.fn(),
    collapseLabel: '',
    lastRenderableTextPartIndex: -1,
    renderAllParts: true,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('AssistantMessageBubble', () => {
  beforeEach(() => {
    resetCollapse()
  })

  it('renders AgentLabel when waggle prop provided', () => {
    const message = createMessage('m1', [textPart('Hello')])
    render(
      <AssistantMessageBubble
        message={message}
        conversationId={defaultConversationId}
        waggle={{ agentLabel: 'Architect', agentColor: 'blue' }}
      />,
    )
    expect(screen.getByTestId('agent-label')).toHaveTextContent('Architect')
  })

  it('renders AgentLabel when assistantModel provided', () => {
    const message = createMessage('m1', [textPart('Hello')])
    render(
      <AssistantMessageBubble
        message={message}
        conversationId={defaultConversationId}
        assistantModel={SupportedModelId('claude-sonnet-4-5')}
      />,
    )
    expect(screen.getByTestId('agent-label')).toHaveTextContent('claude-sonnet-4-5')
  })

  it('renders StreamingText for text parts', () => {
    const message = createMessage('m1', [textPart('Hello world')])
    render(<AssistantMessageBubble message={message} conversationId={defaultConversationId} />)
    expect(screen.getByTestId('streaming-text')).toHaveTextContent('Hello world')
  })

  it('does not render empty text parts', () => {
    const message = createMessage('m1', [textPart('   '), textPart('Visible')])
    render(<AssistantMessageBubble message={message} conversationId={defaultConversationId} />)
    const texts = screen.getAllByTestId('streaming-text')
    expect(texts).toHaveLength(1)
    expect(texts[0]).toHaveTextContent('Visible')
  })

  it('renders ToolCallRouter for tool-call parts', () => {
    const message = createMessage('m1', [toolCallPart('readFile', 'tc-1'), toolResultPart('tc-1')])
    render(<AssistantMessageBubble message={message} conversationId={defaultConversationId} />)
    expect(screen.getByTestId('tool-call-router')).toHaveTextContent('readFile')
  })

  it('does not render tool-result or thinking parts', () => {
    const message = createMessage('m1', [textPart('Hello'), toolResultPart('tc-1'), thinkingPart()])
    const { container } = render(
      <AssistantMessageBubble message={message} conversationId={defaultConversationId} />,
    )
    expect(container.querySelectorAll('[data-testid="streaming-text"]')).toHaveLength(1)
    expect(container.querySelector('[data-testid="tool-result"]')).toBeNull()
    expect(container.querySelector('[data-testid="thinking"]')).toBeNull()
  })

  it('renders all parts when canCollapseToSynthesis=false', () => {
    setCollapse({ canCollapseToSynthesis: false, renderAllParts: true })
    const message = createMessage('m1', [
      textPart('First'),
      toolCallPart('readFile', 'tc-1'),
      textPart('Second'),
    ])
    render(<AssistantMessageBubble message={message} conversationId={defaultConversationId} />)
    expect(screen.getAllByTestId('streaming-text')).toHaveLength(2)
    expect(screen.getByTestId('tool-call-router')).toBeInTheDocument()
  })

  it('renders only lastRenderableTextPartIndex when canCollapseToSynthesis=true and showDetails=false', () => {
    setCollapse({
      canCollapseToSynthesis: true,
      showDetails: false,
      renderAllParts: false,
      lastRenderableTextPartIndex: 2,
      collapseLabel: 'Show 1 tool call',
    })
    const message = createMessage('m1', [
      textPart('Earlier text'),
      toolCallPart('readFile', 'tc-1'),
      textPart('Synthesis'),
    ])
    render(<AssistantMessageBubble message={message} conversationId={defaultConversationId} />)
    const texts = screen.getAllByTestId('streaming-text')
    expect(texts).toHaveLength(1)
    expect(texts[0]).toHaveTextContent('Synthesis')
    expect(screen.queryByTestId('tool-call-router')).toBeNull()
  })

  it('renders CollapsibleDetails divider when canCollapseToSynthesis=true', () => {
    setCollapse({
      canCollapseToSynthesis: true,
      showDetails: false,
      renderAllParts: false,
      lastRenderableTextPartIndex: 1,
      collapseLabel: 'Show 1 tool call',
    })
    const message = createMessage('m1', [toolCallPart('readFile', 'tc-1'), textPart('Summary')])
    render(<AssistantMessageBubble message={message} conversationId={defaultConversationId} />)
    expect(screen.getByTestId('collapsible-details')).toHaveTextContent('Show 1 tool call')
  })

  it('applies waggle border class when waggle prop provided', () => {
    const message = createMessage('m1', [textPart('Hello')])
    const { container } = render(
      <AssistantMessageBubble
        message={message}
        conversationId={defaultConversationId}
        waggle={{ agentLabel: 'Architect', agentColor: 'blue' }}
      />,
    )
    const outer = container.firstElementChild
    expect(outer?.className).toContain('border-l-2')
    expect(outer?.className).toContain('border-l-[#4c8cf5]')
  })
})
