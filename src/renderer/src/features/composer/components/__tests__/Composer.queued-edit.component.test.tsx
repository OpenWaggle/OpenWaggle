import { SessionId } from '@shared/types/brand'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionFollowUpQueueSnapshot } from '@/features/chat/hooks'
import {
  heldItem,
  openedEdit,
  queueItem,
  snapshotOf,
} from '../../hooks/__tests__/queued-message-edit.test-support'
import { useComposerStore } from '../../state/composer-store'
import { useQueuedMessageEditStore } from '../../state/queued-message-edit-store'
import { Composer } from '../Composer'

const queueMock = vi.hoisted(() => {
  const mock: { snapshot: SessionFollowUpQueueSnapshot } & Record<
    'saveEdit' | 'cancelEdit',
    ReturnType<typeof vi.fn>
  > = {
    snapshot: { state: 'running', revision: 1, activeRunId: null, items: [] },
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
  }),
}))

const SESSION = SessionId('session-a')
const QUEUED = queueItem({ id: 'mine', text: 'queued text' })

function renderComposer() {
  const onSend = vi.fn()
  const onEnqueue = vi.fn()
  render(
    <Composer
      onSend={onSend}
      onEnqueue={onEnqueue}
      onCancel={vi.fn()}
      isLoading
      mode={{ queuedMessagesSessionId: SESSION }}
      onToast={vi.fn()}
    />,
  )
  return { onSend, onEnqueue }
}

function input() {
  return screen.getByRole('textbox', { name: 'Message input' })
}

describe('Composer queued-message edit mode', () => {
  beforeAll(() => {
    Range.prototype.getBoundingClientRect = () => new DOMRect()
  })

  beforeEach(() => {
    useComposerStore.setState(useComposerStore.getInitialState())
    useComposerStore.getState().switchScopedDraftContext('project:/repo:session:session-a:main')
    useQueuedMessageEditStore.setState({ edits: {} })
    queueMock.snapshot = snapshotOf([QUEUED])
    queueMock.saveEdit.mockReset().mockResolvedValue(undefined)
    queueMock.cancelEdit.mockReset().mockResolvedValue(undefined)
  })

  function openEdit() {
    useComposerStore.getState().saveScopedDraft('follow-up-edit:session:session-a:stash', {
      input: 'my draft',
      attachments: [],
    })
    useComposerStore.getState().setInput('queued text')
    useQueuedMessageEditStore
      .getState()
      .setEdit('session-a', { phase: 'editing', followUpId: 'mine', based: openedEdit(QUEUED) })
  }

  it('shows the edit bar and saves on Enter instead of queueing', async () => {
    openEdit()
    const { onEnqueue, onSend } = renderComposer()

    expect(screen.getByText('Editing queued message')).toBeInTheDocument()
    expect(screen.getByTitle('Save edit')).toBeInTheDocument()
    await waitFor(() => expect(input()).toHaveTextContent('queued text'))

    fireEvent.keyDown(input(), { key: 'Enter' })

    await waitFor(() =>
      expect(queueMock.saveEdit).toHaveBeenCalledWith(
        openedEdit(QUEUED),
        expect.objectContaining({ text: 'queued text' }),
      ),
    )
    expect(onEnqueue).not.toHaveBeenCalled()
    expect(onSend).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.queryByText('Editing queued message')).not.toBeInTheDocument(),
    )
    expect(useComposerStore.getState().input).toBe('my draft')
  })

  it('cancels on Escape and from the edit bar', async () => {
    openEdit()
    renderComposer()

    fireEvent.keyDown(input(), { key: 'Escape' })

    await waitFor(() => expect(queueMock.cancelEdit).toHaveBeenCalledWith(openedEdit(QUEUED)))
    await waitFor(() => expect(useComposerStore.getState().input).toBe('my draft'))

    act(() => openEdit())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel editing queued message' }))
    await waitFor(() => expect(queueMock.cancelEdit).toHaveBeenCalledTimes(2))
  })

  it('re-adopts a hold this user owns when it mounts without an open edit', async () => {
    useComposerStore.getState().setInput('my draft')
    queueMock.snapshot = snapshotOf([heldItem(QUEUED)])

    renderComposer()

    expect(await screen.findByText('Editing queued message')).toBeInTheDocument()
    await waitFor(() => expect(input()).toHaveTextContent('queued text'))
  })

  it('is an ordinary composer when nothing is being edited', () => {
    renderComposer()

    expect(screen.queryByText('Editing queued message')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Save edit')).not.toBeInTheDocument()
  })
})
