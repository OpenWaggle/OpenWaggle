import { SessionId } from '@shared/types/brand'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SessionControlRejectedError,
  type SessionFollowUpQueueSnapshot,
} from '@/features/chat/hooks'
import { useComposerStore } from '../../state/composer-store'
import { useQueuedMessageEditStore } from '../../state/queued-message-edit-store'
import {
  INTERRUPTED_EDIT_MESSAGE,
  NOT_EDITABLE_MESSAGE,
  WITHDRAWN_EDIT_MESSAGE,
} from '../queued-message-edit-messages'
import { useQueuedMessageEdit } from '../useQueuedMessageEdit'
import { openedEdit, queueItem, snapshotOf } from './queued-message-edit.test-support'

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

vi.mock('@/shared/lib/ipc', () => ({ api: { discardPreparedAttachment: vi.fn() } }))
vi.mock('@/features/chat/hooks/useSessionFollowUpQueue', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSessionFollowUpQueue: () => ({
    snapshot: queueMock.snapshot,
    beginEdit: queueMock.beginEdit,
    saveEdit: queueMock.saveEdit,
    cancelEdit: queueMock.cancelEdit,
    refresh: () => Promise.resolve(queueMock.snapshot),
  }),
}))

const SESSION_A = SessionId('session-a')
const KEY_A = 'project:/repo:session:session-a:main'
const QUEUED = queueItem({ id: 'follow-up-1', text: 'queued text' })

function composer() {
  return useComposerStore.getState()
}

async function renderEditing() {
  const onToast = vi.fn()
  const hook = renderHook(() => useQueuedMessageEdit(SESSION_A, onToast))
  queueMock.beginEdit.mockResolvedValueOnce(openedEdit(QUEUED))
  await act(() => hook.result.current.begin(QUEUED.id))
  act(() => composer().setInput('edited text'))
  return { hook, onToast }
}

describe('useQueuedMessageEdit when the hold is lost', () => {
  beforeEach(() => {
    useComposerStore.setState(useComposerStore.getInitialState())
    useQueuedMessageEditStore.setState({ edits: {} })
    composer().switchScopedDraftContext(KEY_A)
    composer().setInput('my draft')
    queueMock.snapshot = snapshotOf([QUEUED])
    queueMock.beginEdit.mockReset()
    queueMock.saveEdit.mockReset().mockResolvedValue(undefined)
    queueMock.cancelEdit.mockReset().mockResolvedValue(undefined)
  })

  it('takes a fresh hold and keeps the user’s draft when the message is still queued', async () => {
    const { hook, onToast } = await renderEditing()
    queueMock.saveEdit.mockRejectedValueOnce(
      new SessionControlRejectedError('queue-edit-save', 'follow_up_edit_not_held'),
    )
    queueMock.beginEdit.mockResolvedValueOnce({ ...openedEdit(QUEUED, 'hold-2'), queueRevision: 9 })

    await act(() => hook.result.current.save())

    expect(hook.result.current.edit).toMatchObject({
      phase: 'editing',
      based: { holdId: 'hold-2', queueRevision: 9 },
    })
    // Not reloaded from the queued message: what the user typed is still there.
    expect(composer().input).toBe('edited text')
    expect(onToast).toHaveBeenCalledWith(INTERRUPTED_EDIT_MESSAGE)

    await act(() => hook.result.current.save())
    expect(queueMock.saveEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({ holdId: 'hold-2', queueRevision: 9 }),
      expect.objectContaining({ text: 'edited text' }),
    )
    expect(composer().input).toBe('my draft')
  })

  it('keeps a message that is still queued but no longer editable, and offers the text alongside', async () => {
    const { hook, onToast } = await renderEditing()
    queueMock.saveEdit.mockRejectedValueOnce(
      new SessionControlRejectedError('queue-edit-save', 'follow_up_not_editable'),
    )
    queueMock.snapshot = snapshotOf([{ ...QUEUED, editable: false }])

    await act(() => hook.result.current.save())

    expect(queueMock.beginEdit).toHaveBeenCalledTimes(1)
    expect(hook.result.current.edit).toBeNull()
    expect(composer().input).toBe('edited text\n\nmy draft')
    expect(onToast).toHaveBeenCalledWith(NOT_EDITABLE_MESSAGE)
  })

  it('keeps the edited text as a draft when the message being edited is dismissed', async () => {
    const { hook, onToast } = await renderEditing()

    act(() => hook.result.current.endWithdrawnEdit(QUEUED.id))

    expect(hook.result.current.edit).toBeNull()
    expect(composer().input).toBe('edited text\n\nmy draft')
    expect(onToast).toHaveBeenCalledWith(WITHDRAWN_EDIT_MESSAGE)
  })
})
