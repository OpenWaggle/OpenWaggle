import { SessionId } from '@shared/types/brand'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionFollowUpQueueSnapshot } from '@/features/chat/hooks'
import { useEscapeHotkey } from '@/shared/hooks/useEscapeHotkey'
import {
  openedEdit,
  queueItem,
  snapshotOf,
} from '../../hooks/__tests__/queued-message-edit.test-support'
import { SAVE_BUSY_COPY } from '../../hooks/queued-message-edit-messages'
import {
  setDraftActivityForTests,
  useComposerActivityStore,
} from '../../state/composer-activity-store'
import { useComposerStore } from '../../state/composer-store'
import { useQueuedMessageEditStore } from '../../state/queued-message-edit-store'
import { Composer } from '../Composer'

const queueMock = vi.hoisted(() => {
  const mock: { snapshot: SessionFollowUpQueueSnapshot } & Record<
    'saveEdit' | 'cancelEdit',
    ReturnType<typeof vi.fn>
  > = {
    snapshot: { state: 'running', revision: 1, activeRunId: null, items: [], waitingOnEdit: false },
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
    saveEdit: queueMock.saveEdit,
    cancelEdit: queueMock.cancelEdit,
    refresh: () => Promise.resolve(queueMock.snapshot),
    resumeEdit: () => null,
  }),
}))

const SESSION = SessionId('session-a')
const KEY_A = 'project:/repo:session:session-a:main'
const QUEUED = queueItem({ id: 'mine', text: 'queued text' })
const toast = vi.fn()

/** Something else on screen that owns Escape through the shared stack, like an open sheet. */
function OpenSheet({ onClose }: { readonly onClose: () => void }) {
  useEscapeHotkey(onClose)
  return null
}

function renderComposer(extra: React.ReactNode = null) {
  render(
    <>
      <Composer
        onSend={vi.fn()}
        onEnqueue={vi.fn()}
        onCancel={vi.fn()}
        isLoading
        mode={{ queuedMessagesSessionId: SESSION }}
        onToast={toast}
      />
      {extra}
    </>,
  )
}

function input() {
  return screen.getByRole('textbox', { name: 'Message input' })
}

function openEdit(text: string) {
  useComposerStore.getState().saveScopedDraft('follow-up-edit:session:session-a:stash', {
    input: 'my draft',
    attachments: [],
  })
  useComposerStore.getState().setInput(text)
  useQueuedMessageEditStore.getState().setEdit('session-a', {
    phase: 'editing',
    followUpId: 'mine',
    contextKey: KEY_A,
    based: openedEdit(QUEUED),
  })
}

function pressEscape() {
  fireEvent.keyDown(input(), { key: 'Escape' })
}

describe('Composer queued-message edit: Escape, Cancel, and in-flight work', () => {
  beforeAll(() => {
    Range.prototype.getBoundingClientRect = () => new DOMRect()
  })

  beforeEach(() => {
    useComposerStore.setState(useComposerStore.getInitialState())
    useComposerStore.getState().switchScopedDraftContext(KEY_A)
    useQueuedMessageEditStore.setState({ edits: {} })
    useComposerActivityStore.setState({ drafts: {} })
    queueMock.snapshot = snapshotOf([QUEUED])
    queueMock.saveEdit.mockReset().mockResolvedValue(undefined)
    queueMock.cancelEdit.mockReset().mockResolvedValue(undefined)
    toast.mockClear()
  })

  it('asks for a second Escape before discarding changes', async () => {
    openEdit('changed text')
    renderComposer()
    await waitFor(() => expect(input()).toHaveTextContent('changed text'))

    pressEscape()

    expect(queueMock.cancelEdit).not.toHaveBeenCalled()
    expect(screen.getByText('Press Esc again to discard your changes')).toBeInTheDocument()

    pressEscape()

    await waitFor(() => expect(queueMock.cancelEdit).toHaveBeenCalledTimes(1))
  })

  it('leaves Escape to a sheet or popover that owns it on the shared stack', async () => {
    openEdit('queued text')
    const closeSheet = vi.fn()
    renderComposer(<OpenSheet onClose={closeSheet} />)
    await waitFor(() => expect(input()).toHaveTextContent('queued text'))

    pressEscape()

    expect(queueMock.cancelEdit).not.toHaveBeenCalled()
  })

  it('keeps Save unavailable, and says why, while a queued message awaits acknowledgement', async () => {
    openEdit('queued text')
    setDraftActivityForTests(KEY_A, { pendingSubmissions: 1 })
    renderComposer()
    await waitFor(() => expect(input()).toHaveTextContent('queued text'))

    expect(screen.getByTitle('Save edit')).toBeDisabled()
    fireEvent.keyDown(input(), { key: 'Enter' })

    expect(queueMock.saveEdit).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(SAVE_BUSY_COPY.submitting)
  })

  it('keeps focus on Cancel while the Host answers and after a failed cancel', async () => {
    let fail: (error: Error) => void = () => undefined
    queueMock.cancelEdit.mockReturnValueOnce(
      new Promise((_, reject) => {
        fail = reject
      }),
    )
    openEdit('queued text')
    renderComposer()
    await waitFor(() => expect(input()).toHaveTextContent('queued text'))
    // Let the editor's own mount-time autofocus settle first.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    const cancel = screen.getByRole('button', { name: 'Cancel editing queued message' })
    cancel.focus()

    fireEvent.click(cancel)

    await waitFor(() => expect(cancel).toHaveAttribute('aria-disabled', 'true'))
    expect(cancel).not.toBeDisabled()
    expect(cancel).toHaveFocus()
    await act(async () => fail(new Error('Host unavailable')))
    expect(toast).toHaveBeenCalledWith('Host unavailable')
    expect(cancel).toHaveAttribute('aria-disabled', 'false')
    expect(cancel).toHaveFocus()
  })
})
