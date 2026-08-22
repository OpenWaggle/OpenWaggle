import { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatRow } from '../../lib/types-chat-row'
import type { ChatTranscriptSectionState } from '../../model'

/**
 * A saved scroll offset the transcript can no longer reach must not retry forever.
 *
 * The restore retries while the content grows toward a remembered offset. Once the transcript
 * renders a capped window, an offset saved from a taller transcript is permanently unreachable, and
 * the retry rearmed every 96ms for the life of the session: each pass rewrote scrollTop and cleared
 * the auto-scroll flag, so the view snapped back within 96ms of any attempt to scroll and the app
 * read as frozen. Growth is the only evidence that waiting is worthwhile.
 */

const SCROLL_CACHE_KEY = 'openwaggle:scroll-positions:v1'
const RETRY_MS = 96
const UNREACHABLE_OFFSET = 12_000
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
    recentProjects: [],
    activeSessionId: SessionId(SESSION),
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
    onDismissInterruptedRun: vi.fn(),
    onBranchFromMessage: vi.fn(),
    onForkFromMessage: vi.fn(),
    onViewTurnDiff: vi.fn(),
    turnAnchorMessageIds: new Set<string>(),
  }
}

describe('scroll restore against a capped transcript window', () => {
  beforeEach(() => {
    localStorage.setItem(SCROLL_CACHE_KEY, JSON.stringify([[SESSION, UNREACHABLE_OFFSET]]))
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('stops retrying once the content stops growing', async () => {
    const { ChatTranscript } = await import('../ChatTranscript')
    render(<ChatTranscript section={createSection()} />)

    // Let the restore run and rearm as far as it will.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETRY_MS * 40)
    })

    // The offset is unreachable in this environment, so the restore must have given up rather
    // than left a timer behind. A pending timer here is the frozen-transcript bug.
    expect(vi.getTimerCount()).toBe(0)
  })
})
