import { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

type ToolCallPart = Extract<UIMessage['parts'][number], { type: 'tool-call' }>

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock('../ToolCallBlock', () => ({
  ToolCallBlock: ({
    name,
    result,
    isStreaming,
  }: {
    name: string
    result?: { content: unknown; state: string; error?: string }
    isStreaming?: boolean
  }) => (
    <div data-testid="tool-call-block" data-streaming={String(isStreaming)}>
      <span>{name}</span>
      {result && <span data-testid="tool-result-state">{result.state}</span>}
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

const defaultSessionId = SessionId('session-1')

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('ToolCallRouter', () => {
  it('renders ToolCallBlock for generic tool calls', () => {
    const part = makeToolCallPart('read')
    render(
      <ToolCallRouter
        part={part}
        toolResults={emptyResults()}
        sessionId={defaultSessionId}
        isStreaming={false}
      />,
    )
    expect(screen.getByTestId('tool-call-block')).toHaveTextContent('read')
  })

  it('passes persisted tool results through to ToolCallBlock', () => {
    const part = makeToolCallPart('bash', '{"command":"echo hi"}', 'tc-bash')
    render(
      <ToolCallRouter
        part={part}
        toolResults={resultsWithEntry('tc-bash', 'hi')}
        sessionId={defaultSessionId}
        isStreaming={false}
      />,
    )
    expect(screen.getByTestId('tool-result-state')).toHaveTextContent('output-available')
  })

  it('passes streaming state through without special-casing tool names', () => {
    const part = makeToolCallPart('futurePiTool', '{}', 'tc-future')
    render(
      <ToolCallRouter
        part={part}
        toolResults={emptyResults()}
        sessionId={defaultSessionId}
        isStreaming={true}
      />,
    )
    expect(screen.getByTestId('tool-call-block')).toHaveAttribute('data-streaming', 'true')
    expect(screen.getByTestId('tool-call-block')).toHaveTextContent('futurePiTool')
  })
})
