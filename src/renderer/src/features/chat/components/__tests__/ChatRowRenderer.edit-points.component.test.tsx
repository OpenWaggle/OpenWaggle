import { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { TurnCheckpointSummary } from '@shared/types/turn-diff'
import { fireEvent, render, screen } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import type { MessageChatRow } from '../../lib/types-chat-row'
import type { ChatRowRenderContext } from '../ChatRowRenderContext'

const copy = vi.fn()
vi.mock('@/shared/hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({ copied: false, copy }),
}))
vi.mock('@/shared/lib/ipc', () => ({ api: { copyToClipboard: vi.fn() } }))
vi.mock('@/features/workspace-files/hooks', () => ({ useOpenWorkspaceFile: () => vi.fn() }))
vi.mock('@/features/session-summary', () => ({
  SessionMessageImages: () => null,
  useSessionMessageImageResources: () => [],
}))
vi.mock('../StreamingText', () => ({
  StreamingText: ({ text }: { readonly text: string }) => <span>{text}</span>,
}))
vi.mock('../AgentLabel', () => ({ AgentLabel: () => <span>Agent</span> }))
vi.mock('../ChangedFilesCard', () => ({
  ChangedFilesCard: () => <div data-testid="changed-files-card" />,
}))

import { ChatRowRenderer } from '../ChatRowRenderer'

const actions = {
  onBranchFromMessage: vi.fn(),
  onForkFromMessage: vi.fn(),
  onForkFromResponse: vi.fn(),
  onViewTurnDiff: vi.fn(),
  onOpenTurnDiff: vi.fn(),
}

function context(
  turns: ReadonlyMap<string, TurnCheckpointSummary> = new Map(),
): ChatRowRenderContext {
  const extensions = { registry: null, projectPaths: [] }
  return {
    runtime: { sessionId: SessionId('session-1'), extensions },
    extensions,
    turnsByAnchorNodeId: turns,
    actions: { ...actions, turnAnchorMessageIds: new Set(turns.keys()) },
    onDismissError: vi.fn(),
  }
}

function messageRow(
  role: UIMessage['role'],
  options: Partial<Pick<MessageChatRow, 'replyActions' | 'isRunActive'>> = {},
): MessageChatRow {
  return {
    type: 'message',
    message: {
      id: `${role}-1`,
      role,
      parts: [{ type: 'text', content: `${role} text` }],
      createdAt: new Date(0),
    },
    isStreaming: false,
    isRunActive: options.isRunActive ?? false,
    showTurnDivider: false,
    ...(options.replyActions ? { replyActions: options.replyActions } : {}),
  }
}

function buttonNames() {
  return screen.queryAllByRole('button').map((button) => button.getAttribute('aria-label'))
}

/** Edit and fork points are a user message and a settled turn's reply (ADR 0055). */
describe('Transcript edit and fork points', () => {
  it('lets a user message be edited, forked from, or copied', () => {
    render(<ChatRowRenderer row={messageRow('user')} context={context()} />)

    expect(buttonNames()).toEqual(['Edit from here', 'Fork from here', null])
    expect(screen.getByTitle('Copy message')).toBeInTheDocument()
  })

  it("puts a reply's Continue, Fork, and Copy at the end of its turn, after the changed files", () => {
    const turns = new Map([['assistant-1', fromPartial<TurnCheckpointSummary>({ turnIndex: 0 })]])
    const { container } = render(
      <ChatRowRenderer
        row={messageRow('assistant', { replyActions: 'latest' })}
        context={context(turns)}
      />,
    )

    expect(buttonNames()).toEqual([
      'Continue from here',
      'Fork from this response',
      'Copy response',
    ])
    const card = screen.getByTestId('changed-files-card')
    const bar = container.querySelector('[data-turn-reply-actions]')
    expect(bar && card.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copy response' }))
    expect(copy).toHaveBeenCalledWith('assistant text')
  })

  it('offers nothing on an assistant message that is a step of its turn', () => {
    render(<ChatRowRenderer row={messageRow('assistant')} context={context()} />)

    expect(buttonNames()).toEqual([])
  })

  it.each(['user', 'assistant'] as const)(
    'offers no edit or fork point on a %s message while the Session runs',
    (role) => {
      render(
        <ChatRowRenderer
          row={messageRow(role, { replyActions: 'latest', isRunActive: true })}
          context={context()}
        />,
      )

      for (const name of [
        'Edit from here',
        'Fork from here',
        'Continue from here',
        'Fork from this response',
      ]) {
        expect(buttonNames()).not.toContain(name)
      }
    },
  )
})
