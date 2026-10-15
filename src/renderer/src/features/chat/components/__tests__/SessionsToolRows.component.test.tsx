import { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'

type ToolCallPart = Extract<UIMessage['parts'][number], { type: 'tool-call' }>
type NavigateOptions = { to: string; params: Record<string, string> }

const listHiveTreeSessionCatalogPage = vi.hoisted(() => vi.fn())
const navigate = vi.hoisted(() => vi.fn<(options: NavigateOptions) => Promise<unknown>>())

vi.mock('@/shared/lib/ipc', () => ({
  api: { listHiveTreeSessionCatalogPage, copyToClipboard: vi.fn() },
}))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useNavigate: () => navigate,
}))

import { ToolCallRouter } from '../ToolCallRouter'

const QUEEN_ID = SessionId('queen')
const LINEAGE = { directWorkerCount: 0, activeDirectWorkerCount: 0 }

function hivePage() {
  return {
    root: { id: QUEEN_ID, title: 'Queen work', lineage: { ...LINEAGE, role: 'queen' } },
    members: [
      {
        id: SessionId('w1'),
        title: 'Review tool icons',
        lineage: {
          ...LINEAGE,
          role: 'worker',
          parentSessionId: QUEEN_ID,
          agentDefinitionName: 'reviewer',
          delegationState: 'ready_for_review',
        },
      },
    ],
    attentionCount: 0,
  }
}

function call(args: object, id = 'tc-1'): ToolCallPart {
  return {
    type: 'tool-call',
    id,
    name: 'sessions',
    arguments: JSON.stringify(args),
    state: 'input-complete',
  }
}

function resultFor(id: string, outcome: object) {
  return new Map([
    [
      id,
      {
        content: JSON.stringify({ contract: 'session-lifecycle-v2', response: { outcome } }),
        state: 'output-available',
      },
    ],
  ])
}

function renderRow(part: ToolCallPart, toolResults = resultFor(part.id, {})) {
  return renderWithQueryClient(
    <ToolCallRouter
      part={part}
      toolResults={toolResults}
      sessionId={QUEEN_ID}
      isStreaming={false}
    />,
  )
}

describe('sessions-tool rows', () => {
  beforeEach(() => {
    listHiveTreeSessionCatalogPage.mockReset().mockResolvedValue(hivePage())
    navigate.mockReset().mockResolvedValue(undefined)
  })

  it('names a spawned Worker as the Hive does, with its live state and an Open control', async () => {
    renderRow(
      call({ action: 'spawn', objective: 'Old objective', agent: 'reviewer' }),
      resultFor('tc-1', { operation: 'spawn', sessionId: 'w1' }),
    )

    expect(
      await screen.findByText('Spawned Worker (reviewer) · Review tool icons'),
    ).toBeInTheDocument()
    expect(screen.getByText('Ready for review')).toBeInTheDocument()
    expect(document.querySelector('[data-tool-kind="workers"]')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Open Review tool icons' }))
    expect(navigate).toHaveBeenCalledWith({
      to: '/sessions/$sessionId',
      params: { sessionId: 'w1' },
    })
  })

  it('names the Worker a later action targets, without spawn controls', async () => {
    renderRow(call({ action: 'message', sessionId: 'w1', text: 'go' }))

    expect(
      await screen.findByText('Messaged Worker (reviewer) · Review tool icons'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Open / })).toBeNull()
  })

  it('shows no row for a wait', () => {
    const { container } = renderRow(call({ action: 'wait', sessionIds: ['w1'] }))

    expect(container).toBeEmptyDOMElement()
  })
})
