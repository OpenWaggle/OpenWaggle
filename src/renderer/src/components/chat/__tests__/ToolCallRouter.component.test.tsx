import { ConversationId } from '@shared/types/brand'
import type { UIMessage } from '@tanstack/ai-react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

type ToolCallPart = Extract<UIMessage['parts'][number], { type: 'tool-call' }>

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock('../ToolCallBlock', () => ({
  ToolCallBlock: ({ name }: { name: string }) => <div data-testid="tool-call-block">{name}</div>,
}))

vi.mock('../PlanCard', () => ({
  PlanCard: ({ planText }: { planText: string }) => <div data-testid="plan-card">{planText}</div>,
}))

vi.mock('../SubAgentGroup', () => ({
  SubAgentGroup: ({
    tasks,
    isComplete,
  }: {
    tasks: Array<{ id: string; status: string }>
    isComplete: boolean
  }) => (
    <div data-testid="sub-agent-group" data-complete={String(isComplete)}>
      {tasks.map((t) => (
        <span key={t.id} data-testid="task-status">
          {t.status}
        </span>
      ))}
    </div>
  ),
}))

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------
import { ToolCallRouter } from '../ToolCallRouter'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeToolCallPart(
  name: string,
  args = '{}',
  id = 'tc-1',
  state: ToolCallPart['state'] = 'input-complete',
): ToolCallPart {
  return { type: 'tool-call', id, name, arguments: args, state }
}

function emptyResults(): Map<string, { content: unknown; state: string; error?: string }> {
  return new Map()
}

function resultsWithEntry(
  id: string,
  content: unknown,
  state = 'output-available',
  error?: string,
): Map<string, { content: unknown; state: string; error?: string }> {
  const map = new Map<string, { content: unknown; state: string; error?: string }>()
  map.set(id, { content, state, error })
  return map
}

const defaultConversationId = ConversationId('conv-1')
const defaultOnRespondToPlan = vi.fn()

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('ToolCallRouter', () => {
  it('renders null for _turnBoundary tool calls', () => {
    const part = makeToolCallPart('_turnBoundary')
    const { container } = render(
      <ToolCallRouter
        part={part}
        toolResults={emptyResults()}
        conversationId={defaultConversationId}
        isStreaming={false}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders ToolCallBlock for generic tool calls', () => {
    const part = makeToolCallPart('readFile')
    render(
      <ToolCallRouter
        part={part}
        toolResults={emptyResults()}
        conversationId={defaultConversationId}
        isStreaming={false}
      />,
    )
    expect(screen.getByTestId('tool-call-block')).toHaveTextContent('readFile')
  })

  it('renders compact "Answered N questions" when askUser has result', () => {
    const questions = [
      { question: 'Q1', options: [{ label: 'Yes' }] },
      { question: 'Q2', options: [{ label: 'No' }] },
    ]
    const part = makeToolCallPart('askUser', JSON.stringify({ questions }), 'tc-ask')
    render(
      <ToolCallRouter
        part={part}
        toolResults={resultsWithEntry('tc-ask', 'user answered')}
        conversationId={defaultConversationId}
        isStreaming={false}
      />,
    )
    expect(screen.getByText('Answered 2 questions')).toBeInTheDocument()
  })

  it('renders nothing for askUser when no result', () => {
    const part = makeToolCallPart('askUser', '{}', 'tc-ask')
    const { container } = render(
      <ToolCallRouter
        part={part}
        toolResults={emptyResults()}
        conversationId={defaultConversationId}
        isStreaming={false}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders compact "Plan approved" when proposePlan has result with approve action', () => {
    const part = makeToolCallPart('proposePlan', JSON.stringify({ planText: 'My plan' }), 'tc-plan')
    render(
      <ToolCallRouter
        part={part}
        toolResults={resultsWithEntry('tc-plan', JSON.stringify({ action: 'approve' }))}
        conversationId={defaultConversationId}
        onRespondToPlan={defaultOnRespondToPlan}
        isStreaming={false}
      />,
    )
    expect(screen.getByText('Plan approved')).toBeInTheDocument()
  })

  it('renders compact "Plan revised" when proposePlan has result with revise action', () => {
    const part = makeToolCallPart('proposePlan', JSON.stringify({ planText: 'My plan' }), 'tc-plan')
    render(
      <ToolCallRouter
        part={part}
        toolResults={resultsWithEntry(
          'tc-plan',
          JSON.stringify({ action: 'revise', feedback: 'change X' }),
        )}
        conversationId={defaultConversationId}
        onRespondToPlan={defaultOnRespondToPlan}
        isStreaming={false}
      />,
    )
    expect(screen.getByText('Plan revised')).toBeInTheDocument()
  })

  it('renders PlanCard when proposePlan has no result', () => {
    const part = makeToolCallPart(
      'proposePlan',
      JSON.stringify({ planText: 'Step 1: do X' }),
      'tc-plan',
      'input-complete',
    )
    render(
      <ToolCallRouter
        part={part}
        toolResults={emptyResults()}
        conversationId={defaultConversationId}
        onRespondToPlan={defaultOnRespondToPlan}
        isStreaming={false}
      />,
    )
    expect(screen.getByTestId('plan-card')).toHaveTextContent('Step 1: do X')
  })

  it('renders SubAgentGroup for orchestrate tool calls with running status', () => {
    const tasks = [
      { id: 'task-1', title: 'Research' },
      { id: 'task-2', title: 'Implement' },
    ]
    const part = makeToolCallPart('orchestrate', JSON.stringify({ tasks }), 'tc-orch')
    render(
      <ToolCallRouter
        part={part}
        toolResults={emptyResults()}
        conversationId={defaultConversationId}
        isStreaming={true}
      />,
    )
    const group = screen.getByTestId('sub-agent-group')
    expect(group).toBeInTheDocument()
    const statuses = screen.getAllByTestId('task-status')
    expect(statuses).toHaveLength(2)
    for (const status of statuses) {
      expect(status).toHaveTextContent('running')
    }
  })

  it('renders SubAgentGroup with completed status when result exists', () => {
    const tasks = [{ id: 'task-1', title: 'Research' }]
    const part = makeToolCallPart('orchestrate', JSON.stringify({ tasks }), 'tc-orch')
    render(
      <ToolCallRouter
        part={part}
        toolResults={resultsWithEntry('tc-orch', 'done')}
        conversationId={defaultConversationId}
        isStreaming={false}
      />,
    )
    const statuses = screen.getAllByTestId('task-status')
    expect(statuses).toHaveLength(1)
    expect(statuses[0]).toHaveTextContent('completed')
    expect(screen.getByTestId('sub-agent-group').dataset.complete).toBe('true')
  })

  it('renders SubAgentGroup with failed status when result has error', () => {
    const tasks = [{ id: 'task-1', title: 'Research' }]
    const part = makeToolCallPart('orchestrate', JSON.stringify({ tasks }), 'tc-orch')
    render(
      <ToolCallRouter
        part={part}
        toolResults={resultsWithEntry('tc-orch', 'failed', 'error', 'something broke')}
        conversationId={defaultConversationId}
        isStreaming={false}
      />,
    )
    const statuses = screen.getAllByTestId('task-status')
    expect(statuses).toHaveLength(1)
    expect(statuses[0]).toHaveTextContent('failed')
  })
})
