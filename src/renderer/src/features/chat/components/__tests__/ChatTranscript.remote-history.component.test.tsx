import { SessionBranchId, SessionId } from '@shared/types/brand'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatRow } from '../../lib/types-chat-row'
import type { ChatTranscriptSectionState } from '../../model'
import { ChatTranscript } from '../ChatTranscript'

/**
 * The transcript reads only the newest part of a long Session's path (ADR 0036 bounds the
 * transferred rows as well as the mounted ones, B5). Once the loaded rows are exhausted the top
 * edge reads the Host's older page, and a saved position older than the loaded rows reads back
 * to it, instead of showing the start of the Session.
 */

vi.mock('../ChatRowRenderer', () => ({
  ChatRowRenderer: ({ row }: { row: ChatRow }) => (
    <div>{row.type === 'message' ? row.message.id : row.type}</div>
  ),
}))
vi.mock('../WelcomeScreen', () => ({ WelcomeScreen: () => <div>welcome</div> }))
vi.mock('@/shared/lib/ipc', () => ({ api: {} }))
vi.mock('@/features/extensions', () => ({ ExtensionAgentLoopSurface: () => null }))

function row(id: string): ChatRow {
  return {
    type: 'message',
    message: { id, role: 'user', parts: [{ type: 'text', content: id }] },
    isStreaming: false,
    isRunActive: false,
    showTurnDivider: false,
  }
}

function section(
  rows: ChatRow[],
  overrides: Partial<ChatTranscriptSectionState>,
): ChatTranscriptSectionState {
  return {
    transcriptState: 'ready',
    messages: rows.flatMap((r) => (r.type === 'message' ? [r.message] : [])),
    isLoading: false,
    projectPath: '/repo',
    worktreePath: null,
    workingPath: null,
    recentProjects: [],
    activeSessionId: SessionId('session-remote'),
    activeBranchId: SessionBranchId('session-remote:main'),
    turnsByAnchorNodeId: new Map(),
    onToggleTurnFold: () => {},
    onDismissInterruptedRun: () => {},
    chatRows: rows,
    extensionRegistry: null,
    extensionProjectPaths: ['/repo'],
    lastUserMessageId: null,
    streamSignalVersion: 0,
    pendingSend: null,
    onPendingSendConsumed: vi.fn(),
    onOpenProject: vi.fn().mockResolvedValue(undefined),
    onSelectProjectPath: vi.fn(),
    onRetryText: vi.fn().mockResolvedValue(undefined),
    onOpenSettings: vi.fn(),
    onDismissError: vi.fn(),
    onBranchFromMessage: vi.fn(),
    onForkFromMessage: vi.fn(),
    onForkFromResponse: vi.fn(),
    copiesBlocked: false,
    onViewTurnDiff: vi.fn(),
    turnAnchorMessageIds: new Set<string>(),
    ...overrides,
  }
}

const rows = Array.from({ length: 5 }, (_, index) => row(`msg-${String(index)}`))

describe('ChatTranscript remote history (B5)', () => {
  afterEach(() => localStorage.clear())

  // First: reading positions are read from storage once per window.
  it('reads back to a saved reading position older than the loaded rows', () => {
    localStorage.setItem(
      'openwaggle:transcript-reading-positions:v2',
      JSON.stringify([['session-remote:session-remote:main', { key: 'message:old-node', top: 0 }]]),
    )
    const remoteHistory = { hasEarlier: true, loadEarlier: vi.fn(), loadThrough: vi.fn() }
    render(<ChatTranscript section={section(rows, { remoteHistory })} />)

    expect(remoteHistory.loadThrough).toHaveBeenCalledWith('old-node')
  })

  it('offers the Host’s older page once every loaded row is mounted', () => {
    const remoteHistory = { hasEarlier: true, loadEarlier: vi.fn(), loadThrough: vi.fn() }
    render(<ChatTranscript section={section(rows, { sessionCreatedAt: 0, remoteHistory })} />)

    expect(screen.queryByText(/^Start of session/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /load earlier messages/i }))

    expect(remoteHistory.loadEarlier).toHaveBeenCalled()
  })

  it('shows the start of the Session once the Host holds nothing earlier', () => {
    render(<ChatTranscript section={section(rows, { sessionCreatedAt: 0, remoteHistory: null })} />)

    expect(screen.getByText(/^Start of session/)).toBeInTheDocument()
  })
})
