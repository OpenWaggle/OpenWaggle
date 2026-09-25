import { SessionBranchId, SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatRow } from '../../lib/types-chat-row'
import type { ChatTranscriptSectionState } from '../../model'
import { ChatTranscript } from '../ChatTranscript'

/**
 * The transcript renders a bounded window of its rows, identified by row key (ADR 0036).
 *
 * The previous window recorded a count of hidden rows once, at mount. Real-Electron QA showed that
 * count slicing unrelated lists: a branch switch from 400 to 60 messages left one row visible, and
 * a window mounted before hydration built all 400 rows.
 */

const INITIAL_ROWS = 40
const BATCH_ROWS = 40
const PROJECT_PATH = '/repo'

vi.mock('../ChatRowRenderer', () => ({
  ChatRowRenderer: ({ row }: { row: ChatRow }) => (
    <div>{row.type === 'message' ? row.message.id : row.type}</div>
  ),
}))
vi.mock('../WelcomeScreen', () => ({ WelcomeScreen: () => <div>welcome</div> }))
vi.mock('@/shared/lib/ipc', () => ({ api: {} }))
vi.mock('@/features/extensions', () => ({ ExtensionAgentLoopSurface: () => null }))

function message(id: string): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', content: id }] }
}

function row(id: string): ChatRow {
  return {
    type: 'message',
    message: message(id),
    isStreaming: false,
    isRunActive: false,
    showTurnDivider: false,
  }
}

const rowsOf = (count: number, prefix = 'msg') =>
  Array.from({ length: count }, (_, index) => row(`${prefix}-${String(index)}`))

function createSection(
  rows: ChatRow[],
  overrides: Partial<ChatTranscriptSectionState> = {},
): ChatTranscriptSectionState {
  return {
    transcriptState: 'ready',
    messages: rows.flatMap((r) => (r.type === 'message' ? [r.message] : [])),
    isLoading: false,
    projectPath: PROJECT_PATH,
    worktreePath: null,
    recentProjects: [],
    activeSessionId: SessionId('session-1'),
    activeBranchId: SessionBranchId('session-1:main'),
    turnsByAnchorNodeId: new Map(),
    onToggleTurnFold: () => {},
    onDismissInterruptedRun: () => {},
    chatRows: rows,
    extensionRegistry: null,
    extensionProjectPaths: [PROJECT_PATH],
    lastUserMessageId: null,
    streamSignalVersion: 0,
    userDidSend: false,
    onUserDidSendConsumed: vi.fn(),
    onOpenProject: vi.fn().mockResolvedValue(undefined),
    onSelectProjectPath: vi.fn(),
    onRetryText: vi.fn().mockResolvedValue(undefined),
    onOpenSettings: vi.fn(),
    onDismissError: vi.fn(),
    onBranchFromMessage: vi.fn(),
    onForkFromMessage: vi.fn(),
    onViewTurnDiff: vi.fn(),
    turnAnchorMessageIds: new Set<string>(),
    ...overrides,
  }
}

const mountedRows = () =>
  document.querySelectorAll('[data-chat-content-frame="transcript-row"]').length
const loadEarlier = () => screen.queryByRole('button', { name: /load earlier messages/i })

describe('ChatTranscript windowing', () => {
  afterEach(() => localStorage.clear())

  it('renders a short Session whole, under a start-of-session marker', () => {
    render(<ChatTranscript section={createSection(rowsOf(5), { sessionCreatedAt: 0 })} />)

    expect(mountedRows()).toBe(5)
    expect(loadEarlier()).not.toBeInTheDocument()
    expect(screen.getByText(/^Start of session/)).toBeInTheDocument()
  })

  it('builds only the newest rows of a long Session', () => {
    render(<ChatTranscript section={createSection(rowsOf(400))} />)

    expect(mountedRows()).toBe(INITIAL_ROWS)
    expect(screen.getByText('msg-399')).toBeInTheDocument()
    expect(screen.queryByText('msg-359')).not.toBeInTheDocument()
    expect(loadEarlier()).toBeInTheDocument()
    // The old control counted rows as messages ("427 above" on a 400-message Session).
    expect(screen.queryByText(/above\)/)).not.toBeInTheDocument()
  })

  it('bounds image-resource discovery to the mounted rows of a 100k-row Session', () => {
    const renderVisibleMessageRows = vi.fn((_nodeIds: readonly string[], rows: ReactNode) => rows)
    render(
      <ChatTranscript
        section={createSection(rowsOf(100_000))}
        renderVisibleMessageRows={renderVisibleMessageRows}
      />,
    )

    const nodeIds = renderVisibleMessageRows.mock.calls.at(-1)?.[0]
    expect(nodeIds).toHaveLength(INITIAL_ROWS)
    expect(nodeIds?.[0]).toBe('msg-99960')
  })

  it('loads earlier rows in batches and announces them as messages', () => {
    render(<ChatTranscript section={createSection(rowsOf(400))} />)

    const control = loadEarlier()
    if (!control) throw new Error('expected the earlier-rows edge')
    fireEvent.click(control)

    expect(mountedRows()).toBe(INITIAL_ROWS + BATCH_ROWS)
    expect(screen.getByText('msg-320')).toBeInTheDocument()
    expect(screen.getByText(`${String(BATCH_ROWS)} earlier messages loaded`)).toBeInTheDocument()
  })

  it('moves focus to the start marker when the last earlier rows load from the keyboard', () => {
    render(<ChatTranscript section={createSection(rowsOf(INITIAL_ROWS + 10))} />)

    const control = loadEarlier()
    if (!control) throw new Error('expected the earlier-rows edge')
    fireEvent.click(control)

    expect(loadEarlier()).not.toBeInTheDocument()
    expect(screen.getByText(/^Start of session/).parentElement).toHaveFocus()
  })

  it('keeps keyboard focus on the earlier-rows edge across batches', () => {
    render(<ChatTranscript section={createSection(rowsOf(400))} />)

    const first = loadEarlier()
    if (!first) throw new Error('expected the earlier-rows edge')
    first.focus()
    fireEvent.click(first)

    // Review finding: the pressed edge remounted and focus fell to the body mid-history.
    const next = loadEarlier()
    expect(next).not.toBe(first)
    expect(next).toHaveFocus()
  })

  it('opens at the newest rows once history arrives after an empty first render', () => {
    const phase: ChatRow = { type: 'phase-indicator', label: 'Thinking', elapsedMs: 0 }
    const { rerender } = render(
      <ChatTranscript section={createSection([phase], { isLoading: true })} />,
    )
    rerender(
      <ChatTranscript section={createSection([...rowsOf(400), phase], { isLoading: true })} />,
    )

    // Mounted with one status row, the old window computed nothing hidden and built all 400.
    expect(mountedRows()).toBe(INITIAL_ROWS)
  })

  it('shows the newest rows of a branch, never a slice of the previous branch', () => {
    const { rerender } = render(<ChatTranscript section={createSection(rowsOf(400))} />)
    rerender(
      <ChatTranscript
        section={createSection(rowsOf(60, 'alt'), {
          activeBranchId: SessionBranchId('session-1:alt'),
        })}
      />,
    )

    // The reproduced bug: one row under "Load earlier messages (99 above)".
    expect(mountedRows()).toBe(INITIAL_ROWS)
    expect(screen.getByText('alt-59')).toBeInTheDocument()
  })

  it('reopens at the newest rows when compaction replaces the transcript', () => {
    const { rerender } = render(<ChatTranscript section={createSection(rowsOf(400))} />)
    rerender(<ChatTranscript section={createSection(rowsOf(3, 'compacted'))} />)

    expect(mountedRows()).toBe(3)
  })

  it('keeps its first row as new rows arrive', () => {
    const { rerender } = render(<ChatTranscript section={createSection(rowsOf(30))} />)
    rerender(<ChatTranscript section={createSection(rowsOf(60))} />)

    expect(screen.getByText('msg-0')).toBeInTheDocument()
    expect(screen.getByText('msg-59')).toBeInTheDocument()
  })

  it('returns to the newest rows when the Session changes', () => {
    const { rerender } = render(<ChatTranscript section={createSection(rowsOf(400))} />)
    const control = loadEarlier()
    if (!control) throw new Error('expected the earlier-rows edge')
    fireEvent.click(control)
    rerender(
      <ChatTranscript
        section={createSection(rowsOf(400), { activeSessionId: SessionId('session-2') })}
      />,
    )

    expect(mountedRows()).toBe(INITIAL_ROWS)
  })
})

describe('ChatTranscript Session states', () => {
  it('shows a loading state, never the Welcome screen, while a Session hydrates', () => {
    render(<ChatTranscript section={createSection([], { transcriptState: 'loading' })} />)

    expect(screen.queryByText('welcome')).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Loading session' })).toBeInTheDocument()
  })

  it('shows the Welcome screen for a loaded Session with no messages', () => {
    render(<ChatTranscript section={createSection([], { transcriptState: 'ready' })} />)

    expect(screen.getByText('welcome')).toBeInTheDocument()
  })

  it('keeps a hidden scroll-to-bottom control out of input and the accessibility tree', () => {
    render(<ChatTranscript section={createSection(rowsOf(5))} />)

    // It used to stay clickable while invisible, over the bottom of the transcript.
    expect(screen.queryByRole('button', { name: 'Scroll to bottom' })).not.toBeInTheDocument()
  })
})
