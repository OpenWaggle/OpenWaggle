import { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ChatRow } from '../../lib/types-chat-row'
import type { ChatTranscriptSectionState } from '../../model'
import { ChatTranscript } from '../ChatTranscript'

/**
 * The transcript renders the newest slice of a session, not all of it.
 *
 * Opening a 400 message session used to mount every row, which built 7,200 DOM nodes across
 * 50,216px of content in a 580px viewport and pushed click-to-rendered past 1.2 seconds. These
 * tests hold the window in place: how much is built, that the rest is reachable, and that the
 * window returns to the newest rows when the session changes.
 */

const INITIAL_ROW_WINDOW = 40
const LOAD_EARLIER_ROW_COUNT = 100
const PROJECT_PATH = '/repo'

vi.mock('../ChatRowRenderer', () => ({
  ChatRowRenderer: ({ row }: { row: ChatRow }) => (
    <div>{row.type === 'message' ? row.message.id : row.type}</div>
  ),
}))

vi.mock('../WelcomeScreen', () => ({ WelcomeScreen: () => <div>welcome</div> }))
vi.mock('@/shared/lib/ipc', () => ({ api: {} }))
vi.mock('@/features/extensions', () => ({
  ExtensionAgentLoopSurface: () => null,
}))

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

function createSection(rowCount: number, sessionId = 'session-1'): ChatTranscriptSectionState {
  const rows = Array.from({ length: rowCount }, (_, index) => row(`msg-${index}`))
  return {
    messages: rows.map((r) => (r.type === 'message' ? r.message : message('x'))),
    isLoading: false,
    projectPath: PROJECT_PATH,
    recentProjects: [],
    activeSessionId: SessionId(sessionId),
    chatRows: rows,
    extensionRegistry: null,
    extensionProjectPaths: [PROJECT_PATH],
    lastUserMessageId: `msg-${rowCount - 1}`,
    streamSignalVersion: 0,
    userDidSend: false,
    onUserDidSendConsumed: vi.fn(),
    onOpenProject: vi.fn().mockResolvedValue(undefined),
    onSelectProjectPath: vi.fn(),
    onRetryText: vi.fn().mockResolvedValue(undefined),
    onOpenSettings: vi.fn(),
    onDismissError: vi.fn(),
    onDismissInterruptedRun: vi.fn(),
    onBranchFromMessage: vi.fn(),
    onForkFromMessage: vi.fn(),
    onViewTurnDiff: vi.fn(),
    turnAnchorMessageIds: new Set<string>(),
  }
}

describe('ChatTranscript windowing', () => {
  it('renders every row when the session is shorter than the window', () => {
    render(<ChatTranscript section={createSection(5)} />)

    expect(screen.getByText('msg-0')).toBeInTheDocument()
    expect(screen.getByText('msg-4')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /load earlier/i })).not.toBeInTheDocument()
  })

  it('builds only the newest rows for a long session', () => {
    const total = 400
    render(<ChatTranscript section={createSection(total)} />)

    // The newest row is present and the oldest is not built at all.
    expect(screen.getByText(`msg-${total - 1}`)).toBeInTheDocument()
    expect(screen.queryByText('msg-0')).not.toBeInTheDocument()

    // The boundary: the first row inside the window, and the last one outside it.
    expect(screen.getByText(`msg-${total - INITIAL_ROW_WINDOW}`)).toBeInTheDocument()
    expect(screen.queryByText(`msg-${total - INITIAL_ROW_WINDOW - 1}`)).not.toBeInTheDocument()
  })

  it('says how much history is out of view', () => {
    const total = 400
    render(<ChatTranscript section={createSection(total)} />)

    expect(
      screen.getByRole('button', {
        name: `Load earlier messages (${total - INITIAL_ROW_WINDOW} above)`,
      }),
    ).toBeInTheDocument()
  })

  it('reaches further back a page at a time', () => {
    const total = 400
    render(<ChatTranscript section={createSection(total)} />)

    fireEvent.click(screen.getByRole('button', { name: /load earlier/i }))

    const shown = INITIAL_ROW_WINDOW + LOAD_EARLIER_ROW_COUNT
    expect(screen.getByText(`msg-${total - shown}`)).toBeInTheDocument()
    expect(screen.queryByText(`msg-${total - shown - 1}`)).not.toBeInTheDocument()
    // Still more to go, so the control stays with an updated count.
    expect(
      screen.getByRole('button', { name: `Load earlier messages (${total - shown} above)` }),
    ).toBeInTheDocument()
  })

  it('drops the control once the whole session is built', () => {
    // One page of "load earlier" is enough to reach the start.
    render(<ChatTranscript section={createSection(INITIAL_ROW_WINDOW + 10)} />)

    fireEvent.click(screen.getByRole('button', { name: /load earlier/i }))

    expect(screen.getByText('msg-0')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /load earlier/i })).not.toBeInTheDocument()
  })

  it('returns to the newest rows when the session changes', () => {
    const total = 400
    const { rerender } = render(<ChatTranscript section={createSection(total, 'session-1')} />)

    fireEvent.click(screen.getByRole('button', { name: /load earlier/i }))
    expect(
      screen.getByText(`msg-${total - INITIAL_ROW_WINDOW - LOAD_EARLIER_ROW_COUNT}`),
    ).toBeInTheDocument()

    // A different session must not inherit the previous session's expanded window.
    rerender(<ChatTranscript section={createSection(total, 'session-2')} />)

    expect(screen.getByText(`msg-${total - 1}`)).toBeInTheDocument()
    expect(
      screen.queryByText(`msg-${total - INITIAL_ROW_WINDOW - LOAD_EARLIER_ROW_COUNT}`),
    ).not.toBeInTheDocument()
  })
})
