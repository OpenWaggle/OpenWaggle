import { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatRow } from '../../lib/types-chat-row'
import type { ChatTranscriptSectionState } from '../../model'

/**
 * Reading positions restore by row, and one whose row never arrives must not linger.
 *
 * The previous pixel restore retried toward an offset a capped window could never reach; the
 * retry rearmed for the life of the Session and snapped the view back within 96ms of any scroll,
 * so the app read as frozen. Positions are now row anchors (ADR 0036): a missing row is simply not
 * restored, and nothing is left running.
 */

const POSITIONS_KEY = 'openwaggle:transcript-reading-positions:v2'
const GRACE_MS = 2000
const ROW_COUNT = 400
const SESSION = 'session-restore-1'

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

function createSection(): ChatTranscriptSectionState {
  const rows = Array.from({ length: ROW_COUNT }, (_, index) => row(`msg-${index}`))
  return {
    messages: rows.map((r) => (r.type === 'message' ? r.message : message('x'))),
    isLoading: false,
    projectPath: '/repo',
    worktreePath: null,
    recentProjects: [],
    activeSessionId: SessionId(SESSION),
    turnsByAnchorNodeId: new Map(),
    onToggleTurnFold: () => {},
    onDismissInterruptedRun: () => {},
    chatRows: rows,
    extensionRegistry: null,
    extensionProjectPaths: ['/repo'],
    lastUserMessageId: `msg-${ROW_COUNT - 1}`,
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
  }
}

describe('reading-position restore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('leaves nothing running when the saved row never arrives', async () => {
    localStorage.setItem(
      POSITIONS_KEY,
      JSON.stringify([[`${SESSION}:main`, { key: 'message:gone', top: 12 }]]),
    )
    const { ChatTranscript } = await import('../ChatTranscript')
    render(<ChatTranscript section={createSection()} />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(GRACE_MS)
    })

    expect(vi.getTimerCount()).toBe(0)
  })

  it('builds the first window around a saved row deep in older history', async () => {
    localStorage.setItem(
      POSITIONS_KEY,
      JSON.stringify([[`${SESSION}:main`, { key: 'message:msg-100', top: 12 }]]),
    )
    vi.resetModules()
    const { ChatTranscript } = await import('../ChatTranscript')
    const { getByText, queryByText } = render(<ChatTranscript section={createSection()} />)

    // The pixel restore reopened at the newest 40 rows and landed on a different message.
    expect(getByText('msg-100')).toBeInTheDocument()
    expect(getByText('msg-80')).toBeInTheDocument()
    expect(queryByText('msg-399')).not.toBeInTheDocument()
  })

  it('builds the window around a saved row that only arrives with a later hydration commit', async () => {
    localStorage.setItem(
      POSITIONS_KEY,
      JSON.stringify([[`${SESSION}:main`, { key: 'message:msg-100', top: 12 }]]),
    )
    vi.resetModules()
    const { ChatTranscript } = await import('../ChatTranscript')
    const phase: ChatRow = { type: 'phase-indicator', label: 'Thinking', elapsedMs: 0 }
    const partial = { ...createSection(), chatRows: [phase], messages: [] }
    const { rerender, getByText } = render(<ChatTranscript section={partial} />)
    rerender(<ChatTranscript section={createSection()} />)

    // Review finding: the first window opened at the newest rows and never reached the saved row.
    expect(getByText('msg-100')).toBeInTheDocument()
  })
})
