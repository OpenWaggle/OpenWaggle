import { SessionId, SupportedModelId } from '@shared/types/brand'
import type {
  ChatTextPart,
  ChatThinkingPart,
  ChatToolCallPart,
  ChatToolResultPart,
  UIMessage,
  UIMessagePart,
} from '@shared/types/chat-ui'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UseMessageCollapseResult } from '../../hooks/useMessageCollapse'

// ---------------------------------------------------------------------------
// Hoisted mock handles
// ---------------------------------------------------------------------------
const mockCollapse = vi.hoisted((): { current: UseMessageCollapseResult } => ({
  current: {
    canCollapseDetails: false,
    showDetails: false,
    toggleDetails: vi.fn(),
    collapseLabel: '',
    lastRenderableTextPartIndex: -1,
    renderAllParts: true,
  },
}))

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock('../../hooks/useMessageCollapse', () => ({
  useMessageCollapse: () => mockCollapse.current,
}))

vi.mock('../StreamingText', () => ({
  StreamingText: ({
    text,
    visualizationSessionId,
  }: {
    text: string
    visualizationSessionId?: string
  }) => (
    <div data-testid="streaming-text" data-visualization-session={visualizationSessionId}>
      {text}
    </div>
  ),
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
import { AssistantMessageBubble, type WaggleInfo } from '../AssistantMessageBubble'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function textPart(content: string): ChatTextPart {
  return { type: 'text', content }
}

function toolCallPart(name: string, id = 'tc-1'): ChatToolCallPart {
  return { type: 'tool-call', id, name, arguments: '{}', state: 'output-available' }
}

function toolResultPart(toolCallId: string): ChatToolResultPart {
  return {
    type: 'tool-result',
    toolCallId,
    content: 'ok',
    state: 'output-available',
  }
}

function thinkingPart(): ChatThinkingPart {
  return { type: 'thinking', content: 'internal reasoning' }
}

function createMessage(id: string, parts: UIMessagePart[]): UIMessage {
  return { id, role: 'assistant', parts }
}

const defaultSessionId = SessionId('session-1')

interface RenderAssistantOptions {
  readonly message: UIMessage
  readonly waggle?: WaggleInfo
  readonly assistantModel?: SupportedModelId
  readonly hideAgentLabel?: boolean
  readonly actions?: {
    readonly onBranchFromMessage?: (messageId: string) => void
    readonly onViewTurnDiff?: (messageId: string) => void
  }
}

function renderAssistantMessage({
  message,
  waggle,
  assistantModel,
  hideAgentLabel,
  actions,
}: RenderAssistantOptions) {
  return render(
    <AssistantMessageBubble
      message={message}
      runtime={{
        sessionId: defaultSessionId,
        extensions: { registry: null, projectPaths: [] },
      }}
      run={assistantModel ? { assistantModel } : undefined}
      waggle={waggle}
      presentation={hideAgentLabel ? { hideAgentLabel } : undefined}
      actions={actions}
    />,
  )
}

function setCollapse(overrides: Partial<UseMessageCollapseResult>) {
  mockCollapse.current = { ...mockCollapse.current, ...overrides }
}

function resetCollapse() {
  mockCollapse.current = {
    canCollapseDetails: false,
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
    renderAssistantMessage({
      message,
      waggle: { agentLabel: 'Architect', agentColor: 'blue' },
    })
    expect(screen.getByTestId('agent-label')).toHaveTextContent('Architect')
  })

  it('renders AgentLabel when assistantModel provided', () => {
    const message = createMessage('m1', [textPart('Hello')])
    renderAssistantMessage({
      message,
      assistantModel: SupportedModelId('claude-sonnet-4-5'),
    })
    expect(screen.getByTestId('agent-label')).toHaveTextContent('claude-sonnet-4-5')
  })

  it('renders StreamingText for text parts', () => {
    const message = createMessage('m1', [textPart('Hello world')])
    renderAssistantMessage({ message })
    expect(screen.getByTestId('streaming-text')).toHaveTextContent('Hello world')
  })

  it('uses persisted visualization ownership for a copied assistant message', () => {
    const message = {
      ...createMessage('m1', [textPart('Copied visualization')]),
      metadata: { visualizationSessionId: SessionId('source-session') },
    }

    renderAssistantMessage({ message })

    expect(screen.getByTestId('streaming-text')).toHaveAttribute(
      'data-visualization-session',
      'source-session',
    )
  })

  it('does not render empty text parts', () => {
    const message = createMessage('m1', [textPart('   '), textPart('Visible')])
    renderAssistantMessage({ message })
    const texts = screen.getAllByTestId('streaming-text')
    expect(texts).toHaveLength(1)
    expect(texts[0]).toHaveTextContent('Visible')
  })

  it('renders ToolCallRouter for tool-call parts', () => {
    const message = createMessage('m1', [toolCallPart('read', 'tc-1'), toolResultPart('tc-1')])
    renderAssistantMessage({ message })
    expect(screen.getByTestId('tool-call-router')).toHaveTextContent('read')
  })

  it('renders standalone tool-result parts while keeping matched tool-call results nested', () => {
    const message = createMessage('m1', [textPart('Hello'), toolResultPart('tc-1'), thinkingPart()])
    const { container } = renderAssistantMessage({ message })
    expect(container.querySelectorAll('[data-testid="streaming-text"]')).toHaveLength(3)
    expect(screen.getByText('internal reasoning')).toBeInTheDocument()
    expect(screen.getByText('Tool result · output-available')).toBeInTheDocument()
    const streamedParts = screen.getAllByTestId('streaming-text')
    expect(streamedParts[0]).toHaveAttribute('data-visualization-session', defaultSessionId)
    expect(streamedParts[1]).not.toHaveAttribute('data-visualization-session')
    expect(streamedParts[2]).not.toHaveAttribute('data-visualization-session')
  })

  it('renders all parts when canCollapseDetails=false', () => {
    setCollapse({ canCollapseDetails: false, renderAllParts: true })
    const message = createMessage('m1', [
      textPart('First'),
      toolCallPart('read', 'tc-1'),
      textPart('Second'),
    ])
    renderAssistantMessage({ message })
    expect(screen.getAllByTestId('streaming-text')).toHaveLength(2)
    expect(screen.getByTestId('tool-call-router')).toBeInTheDocument()
  })

  it('renders only lastRenderableTextPartIndex when canCollapseDetails=true and showDetails=false', () => {
    setCollapse({
      canCollapseDetails: true,
      showDetails: false,
      renderAllParts: false,
      lastRenderableTextPartIndex: 2,
      collapseLabel: 'Show 1 tool call',
    })
    const message = createMessage('m1', [
      textPart('Earlier text'),
      toolCallPart('read', 'tc-1'),
      textPart('Final answer'),
    ])
    renderAssistantMessage({ message })
    const texts = screen.getAllByTestId('streaming-text')
    expect(texts).toHaveLength(1)
    expect(texts[0]).toHaveTextContent('Final answer')
    expect(screen.queryByTestId('tool-call-router')).toBeNull()
  })

  it('renders CollapsibleDetails divider when canCollapseDetails=true', () => {
    setCollapse({
      canCollapseDetails: true,
      showDetails: false,
      renderAllParts: false,
      lastRenderableTextPartIndex: 1,
      collapseLabel: 'Show 1 tool call',
    })
    const message = createMessage('m1', [toolCallPart('read', 'tc-1'), textPart('Summary')])
    renderAssistantMessage({ message })
    expect(screen.getByTestId('collapsible-details')).toHaveTextContent('Show 1 tool call')
  })

  it('leaves the continuous waggle rail to the turn wrapper', () => {
    const message = createMessage('m1', [textPart('Hello')])
    const { container } = renderAssistantMessage({
      message,
      waggle: { agentLabel: 'Architect', agentColor: 'blue' },
    })
    const outer = container.firstElementChild
    expect(outer?.className).not.toContain('border-l-2')
    expect(screen.getByTestId('agent-label')).toHaveTextContent('Architect')
  })

  it('hides repeated agent label when rendered inside a grouped waggle turn', () => {
    const message = createMessage('m1', [textPart('Hello')])
    renderAssistantMessage({
      message,
      waggle: { agentLabel: 'Architect', agentColor: 'blue' },
      assistantModel: SupportedModelId('gpt-5.5'),
      hideAgentLabel: true,
    })
    expect(screen.queryByTestId('agent-label')).toBeNull()
    expect(screen.getByTestId('streaming-text')).toHaveTextContent('Hello')
  })

  it('renders a View turn diff button and fires onViewTurnDiff', () => {
    const onViewTurnDiff = vi.fn()
    const message = createMessage('m1', [textPart('Hello')])
    renderAssistantMessage({
      message,
      assistantModel: SupportedModelId('gpt-5.5'),
      actions: { onViewTurnDiff },
    })
    const button = screen.getByRole('button', { name: 'View turn diff' })
    button.click()
    expect(onViewTurnDiff).toHaveBeenCalledWith('m1')
  })

  it('omits the View turn diff button when no reveal handler is provided', () => {
    const message = createMessage('m1', [textPart('Hello')])
    renderAssistantMessage({ message, assistantModel: SupportedModelId('gpt-5.5') })
    expect(screen.queryByRole('button', { name: 'View turn diff' })).toBeNull()
  })
})
