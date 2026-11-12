import { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { TurnCheckpointSummary, TurnDiffFileSummary } from '@shared/types/turn-diff'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useChangedFilesCardStore } from '../../state/changed-files-card-store'
import type { MessageChatRow } from '../../lib/types-chat-row'
import type { ChatRowRenderContext } from '../ChatRowRenderContext'

const ipc = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
  listTurnDiffFiles: vi.fn(async (_sessionId: string, turnIds: readonly string[]) =>
    Object.fromEntries(
      turnIds.map((turnId): [string, readonly TurnDiffFileSummary[]] => [
        turnId,
        [{ path: 'src/app.ts', additions: 3, deletions: 1 }],
      ]),
    ),
  ),
}))

vi.mock('@/shared/lib/ipc', async () => ({
  api: (await import('@/test-utils/preload-api')).preloadApi(ipc),
}))

import { ChatRowRenderer } from '../ChatRowRenderer'
import { renderInMemoryRouter } from '@/test-utils/memory-router'

/*
 * Only the preload is replaced: the message bubbles, Waggle divider, changed-files card and reply
 * bar are the real ones, inside a real memory router for the workspace-file links.
 */
const actions = {
  onBranchFromMessage: vi.fn(),
  onForkFromMessage: vi.fn(),
  onForkFromResponse: vi.fn(),
  onViewTurnDiff: vi.fn(),
  onOpenTurnDiff: vi.fn(),
}

const SETTLED_TURN: TurnCheckpointSummary = {
  turnId: 'turn-1',
  turnIndex: 0,
  createdAt: 0,
  insertions: 3,
  deletions: 1,
}

function context(
  options: { readonly withTurn?: boolean; readonly copiesBlocked?: boolean } = {},
): ChatRowRenderContext {
  const extensions = { registry: null, projectPaths: [] }
  const turns = new Map(options.withTurn ? [['assistant-1', SETTLED_TURN]] : [])
  return {
    runtime: { sessionId: SessionId('session-1'), extensions },
    extensions,
    turnsByAnchorNodeId: turns,
    actions: {
      ...actions,
      turnAnchorMessageIds: new Set(turns.keys()),
      ...(options.copiesBlocked ? { copiesBlocked: true } : {}),
    },
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

function replyBar(container: HTMLElement) {
  const bar = container.querySelector<HTMLElement>('[data-turn-reply-actions]')
  if (!bar) throw new Error('Expected the reply action bar.')
  return bar
}

function buttonNames(scope: HTMLElement = document.body) {
  return within(scope)
    .queryAllByRole('button')
    .map((button) => button.getAttribute('aria-label'))
}

/** The changed-files card, once its files arrived from the preload. */
async function changedFilesCard() {
  const openDiff = await screen.findByRole('button', { name: 'Open diff' })
  const card = openDiff.closest<HTMLElement>('[data-testid="changed-files-card"]')
  if (!card) throw new Error('Expected the changed-files card.')
  return card
}

function follows(earlier: Element, later: Element) {
  return (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

const EDIT_AND_FORK_POINTS = [
  'Edit from here',
  'Fork from here',
  'Continue from here',
  'Fork from this response',
]

/** Edit and fork points are a user message and a settled turn's reply (ADR 0055). */
describe('Transcript edit and fork points', () => {
  afterEach(() => {
    vi.clearAllMocks()
    useChangedFilesCardStore.setState({ expandedByCardKey: {} })
  })

  it('lets a user message be edited, forked from, or copied', async () => {
    await renderInMemoryRouter(<ChatRowRenderer row={messageRow('user')} context={context()} />)

    expect(buttonNames()).toEqual(['Edit from here', 'Fork from here', 'Copy message'])
  })

  it("puts a reply's Continue, Fork, and Copy at the end of its turn, after the changed files", async () => {
    const { container } = await renderInMemoryRouter(
      <ChatRowRenderer
        row={messageRow('assistant', { replyActions: 'latest' })}
        context={context({ withTurn: true })}
      />,
    )

    const card = await changedFilesCard()
    const bar = replyBar(container)
    expect(buttonNames(bar)).toEqual([
      'Continue from here',
      'Fork from this response',
      'Copy response',
    ])
    expect(follows(card, bar)).toBe(true)
    await userEvent.click(within(bar).getByRole('button', { name: 'Copy response' }))
    expect(ipc.copyToClipboard).toHaveBeenCalledWith('assistant text')
  })

  it('offers nothing on an assistant message that is a step of its turn', async () => {
    await renderInMemoryRouter(
      <ChatRowRenderer row={messageRow('assistant')} context={context()} />,
    )

    expect(screen.getByText('assistant text')).toBeInTheDocument()
    expect(buttonNames()).toEqual([])
  })

  it('hands Continue and Fork from this response the reply it sits under', async () => {
    await renderInMemoryRouter(
      <ChatRowRenderer
        row={messageRow('assistant', { replyActions: 'reply' })}
        context={context()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Continue from here' }))
    await userEvent.click(screen.getByRole('button', { name: 'Fork from this response' }))

    expect(actions.onBranchFromMessage).toHaveBeenCalledWith('assistant-1')
    expect(actions.onForkFromResponse).toHaveBeenCalledWith('assistant-1')
  })

  it.each([
    { role: 'user', holder: 'the Session runs', isRunActive: true, copiesBlocked: false },
    { role: 'assistant', holder: 'the Session runs', isRunActive: true, copiesBlocked: false },
    { role: 'user', holder: 'the Host settles the Run', isRunActive: false, copiesBlocked: true },
    {
      role: 'assistant',
      holder: 'the Host settles the Run',
      isRunActive: false,
      copiesBlocked: true,
    },
  ] as const)(
    'offers no edit or fork point on a $role message while $holder',
    async ({ role, isRunActive, copiesBlocked }) => {
      await renderInMemoryRouter(
        <ChatRowRenderer
          row={messageRow(role, {
            ...(role === 'assistant' ? { replyActions: 'latest' as const } : {}),
            isRunActive,
          })}
          context={context({ copiesBlocked })}
        />,
      )

      expect(screen.getByText(`${role} text`)).toBeInTheDocument()
      for (const name of EDIT_AND_FORK_POINTS) expect(buttonNames()).not.toContain(name)
    },
  )

  it("keeps a reply's bar, with Copy, in place while the Session runs, so sending does not move it", async () => {
    const { container } = await renderInMemoryRouter(
      <ChatRowRenderer
        row={messageRow('assistant', { replyActions: 'latest', isRunActive: true })}
        context={context()}
      />,
    )

    expect(buttonNames(replyBar(container))).toEqual(['Copy response'])
  })

  it("shows an expanded Waggle turn's changed files and ends the turn with its reply's bar", async () => {
    const { container } = await renderInMemoryRouter(
      <ChatRowRenderer
        row={{
          type: 'waggle-turn',
          id: 'waggle-1',
          turnDividerProps: { turnNumber: 0, agentLabel: 'Architect', agentColor: 'blue' },
          agentColor: 'blue',
          messages: [messageRow('assistant', { replyActions: 'latest' })],
          folded: false,
        }}
        context={context({ withTurn: true })}
      />,
    )

    expect(screen.getByText('Turn 1: Architect')).toBeInTheDocument()
    const card = await changedFilesCard()
    expect(follows(card, replyBar(container))).toBe(true)
  })
})
