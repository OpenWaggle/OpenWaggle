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

    fireEvent.click(screen.getByRole('button', { name: 'Open Worker Session: Review tool icons' }))
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

  it('keeps a spawn the Hive does not know yet to its requested name, without controls', async () => {
    listHiveTreeSessionCatalogPage.mockResolvedValue({ ...hivePage(), members: [] })
    renderRow(call({ action: 'spawn', objective: 'Check main', agent: 'reviewer' }))

    expect(await screen.findByText('Spawned Worker (reviewer) · Check main')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Open / })).toBeNull()
  })

  it('names a Worker from a call a script made, and leaves its wait out', async () => {
    renderWithQueryClient(
      <ToolCallRouter
        part={{
          type: 'tool-call',
          id: 'code-1',
          name: 'codemode',
          arguments: '{}',
          state: 'input-complete',
          nestedCalls: {
            complete: true,
            calls: [
              {
                id: 'code-1/1',
                name: 'sessions',
                args: { action: 'message', sessionId: 'w1' },
                status: 'ok',
              },
              {
                id: 'code-1/2',
                name: 'sessions',
                args: { action: 'wait', sessionIds: ['w1'] },
                status: 'ok',
              },
            ],
          },
        }}
        toolResults={new Map([['code-1', { content: 'done', state: 'output-available' }]])}
        sessionId={QUEEN_ID}
        isStreaming={false}
      />,
    )

    const nested = await screen.findByRole('list', { name: 'Tool calls made by codemode' })
    expect(
      await screen.findByText('Messaged Worker (reviewer) · Review tool icons'),
    ).toBeInTheDocument()
    expect(nested.querySelectorAll('li')).toHaveLength(1)
  })

  it('shows no row for a wait', () => {
    const { container } = renderRow(call({ action: 'wait', sessionIds: ['w1'] }))

    expect(container).toBeEmptyDOMElement()
  })
})
