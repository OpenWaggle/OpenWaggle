import { SessionId } from '@shared/types/brand'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionFollowUpQueueSnapshot } from '@/features/chat/hooks'
import {
  openedEdit,
  queueItem,
  snapshotOf,
} from '../../hooks/__tests__/queued-message-edit.test-support'
import { useComposerActivityStore } from '../../state/composer-activity-store'
import { useComposerStore } from '../../state/composer-store'
import { useQueuedMessageEditStore } from '../../state/queued-message-edit-store'
import { Composer } from '../Composer'
import { QueuedMessages } from '../QueuedMessages'

const queueMock = vi.hoisted(() => {
  const mock: { snapshot: SessionFollowUpQueueSnapshot } & Record<
    'beginEdit' | 'saveEdit' | 'cancelEdit',
    ReturnType<typeof vi.fn>
  > = {
    snapshot: { state: 'running', revision: 1, activeRunId: null, items: [], waitingOnEdit: false },
    beginEdit: vi.fn(),
    saveEdit: vi.fn(),
    cancelEdit: vi.fn(),
  }
  return mock
})

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getSettings: vi.fn().mockResolvedValue({}),
    updateSettings: vi.fn().mockResolvedValue({ ok: true }),
    getProviderModels: vi.fn().mockResolvedValue([]),
    listWagglePresets: vi.fn().mockResolvedValue([]),
    listExtensionContributions: vi.fn().mockResolvedValue({ projectPaths: [], entries: [] }),
  },
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@/features/sessions/hooks', () => ({ useProject: () => ({ projectPath: '/repo' }) }))
vi.mock('@/features/chat/hooks/useSessionFollowUpQueue', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSessionFollowUpQueue: () => ({
    snapshot: queueMock.snapshot,
    error: null,
    refresh: vi.fn(),
    beginEdit: queueMock.beginEdit,
    saveEdit: queueMock.saveEdit,
    cancelEdit: queueMock.cancelEdit,
  }),
}))

const SESSION = SessionId('session-a')
const QUEUED = queueItem({ id: 'mine', text: 'queued text' })

function renderStack() {
  render(
    <>
      <QueuedMessages sessionId={SESSION} onSteer={vi.fn()} isStreaming onToast={vi.fn()} />
      <Composer
        onSend={vi.fn()}
        onEnqueue={vi.fn()}
        onCancel={vi.fn()}
        isLoading
        mode={{ queuedMessagesSessionId: SESSION }}
        onToast={vi.fn()}
      />
    </>,
  )
}

function input() {
  return screen.getByRole('textbox', { name: 'Message input' })
}

describe('queued-message edit focus', () => {
  beforeAll(() => {
    Range.prototype.getBoundingClientRect = () => new DOMRect()
  })

  beforeEach(() => {
    useComposerStore.setState(useComposerStore.getInitialState())
    useComposerStore.getState().switchScopedDraftContext('project:/repo:session:session-a:main')
    useComposerStore.getState().setInput('my draft')
    useQueuedMessageEditStore.setState({ edits: {} })
    useComposerActivityStore.setState({ preparingAttachments: 0, pendingSubmissions: 0 })
    queueMock.snapshot = snapshotOf([QUEUED])
    queueMock.beginEdit.mockReset().mockResolvedValue(openedEdit(QUEUED))
    queueMock.saveEdit.mockReset().mockResolvedValue(undefined)
  })

  it('moves focus into the input when the edit opens, and keeps it there after saving', async () => {
    renderStack()
    const edit = screen.getByRole('button', { name: 'Edit queued message: queued text' })
    edit.focus()

    fireEvent.click(edit)

    await waitFor(() => expect(input()).toHaveTextContent('queued text'))
    await waitFor(() => expect(input()).toHaveFocus())

    fireEvent.keyDown(input(), { key: 'Enter' })

    await waitFor(() => expect(input()).toHaveTextContent('my draft'))
    expect(queueMock.saveEdit).toHaveBeenCalledTimes(1)
    expect(input()).toHaveFocus()
  })
})
