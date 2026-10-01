import { SessionId } from '@shared/types/brand'
import { act, renderHook, waitFor } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SessionControlRejectedError,
  type SessionFollowUpQueueSnapshot,
} from '@/features/chat/hooks'
import { useBranchSummaryStore } from '@/features/chat/state'
import {
  setDraftActivityForTests,
  useComposerActivityStore,
} from '../../state/composer-activity-store'
import { useComposerStore } from '../../state/composer-store'
import {
  queuedMessageEditStashKey,
  useQueuedMessageEditStore,
} from '../../state/queued-message-edit-store'
import { BEGIN_BLOCK_COPY, SAVE_BUSY_COPY } from '../queued-message-edit-messages'
import { useAdoptHeldQueuedMessageEdit, useQueuedMessageEdit } from '../useQueuedMessageEdit'
import {
  BASE_QUEUE_REVISION,
  heldItem,
  openedEdit,
  preparedAttachment,
  queueItem,
  resumeFrom,
  snapshotOf,
} from './queued-message-edit.test-support'

const queueMock = vi.hoisted(() => {
  const mock: {
    snapshot: SessionFollowUpQueueSnapshot
    /** What a refetch returns, when it differs from the rendered snapshot. */
    fresh: SessionFollowUpQueueSnapshot | null
  } & Record<'beginEdit' | 'saveEdit' | 'cancelEdit' | 'discard', ReturnType<typeof vi.fn>> = {
    snapshot: { state: 'running', revision: 1, activeRunId: null, items: [], waitingOnEdit: false },
    fresh: null,
    beginEdit: vi.fn(),
    saveEdit: vi.fn(),
    cancelEdit: vi.fn(),
    discard: vi.fn(),
  }
  return mock
})

vi.mock('@/shared/lib/ipc', () => ({
  api: { discardPreparedAttachment: queueMock.discard },
}))

vi.mock('@/features/chat/hooks/useSessionFollowUpQueue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/chat/hooks')>()
  return {
    ...actual,
    useSessionFollowUpQueue: () => ({
      snapshot: queueMock.snapshot,
      beginEdit: queueMock.beginEdit,
      saveEdit: queueMock.saveEdit,
      cancelEdit: queueMock.cancelEdit,
      ...resumeFrom(queueMock.fresh ?? queueMock.snapshot, actual.heldEdit),
    }),
  }
})

const SESSION_A = SessionId('session-a')
const KEY_A = 'project:/repo:session:session-a:branch:main'
const KEY_A_OTHER_BRANCH = 'project:/repo:session:session-a:branch:other'
const QUEUED = queueItem({
  id: 'follow-up-1',
  text: 'queued text',
  attachments: [
    { id: 'host-1', kind: 'text', name: 'notes.txt', mimeType: 'text/plain', sizeBytes: 12 },
  ],
})

function composer() {
  return useComposerStore.getState()
}

function deferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function renderOpenEdit() {
  const onToast = vi.fn()
  const hook = renderHook(() => useQueuedMessageEdit(SESSION_A, onToast))
  queueMock.beginEdit.mockResolvedValueOnce(openedEdit(QUEUED))
  await act(() => hook.result.current.begin(QUEUED.id))
  return { hook, onToast }
}

describe('useQueuedMessageEdit in flight', () => {
  beforeEach(() => {
    useComposerStore.setState(useComposerStore.getInitialState())
    useQueuedMessageEditStore.setState({ edits: {} })
    useComposerActivityStore.setState({ drafts: {} })
    useBranchSummaryStore.getState().clearPrompt()
    composer().switchScopedDraftContext(KEY_A)
    composer().setInput('my draft')
    queueMock.snapshot = snapshotOf([QUEUED])
    queueMock.beginEdit.mockReset()
    queueMock.saveEdit.mockReset().mockResolvedValue(undefined)
    queueMock.cancelEdit.mockReset().mockResolvedValue(undefined)
  })

  it('stays bound to its branch draft: elsewhere it is not edit mode, and cancel restores there', async () => {
    const { hook } = await renderOpenEdit()

    act(() => {
      composer().switchScopedDraftContext(KEY_A_OTHER_BRANCH)
    })
    expect(hook.result.current.isVisible).toBe(false)
    await act(() => hook.result.current.save())
    expect(queueMock.saveEdit).not.toHaveBeenCalled()

    await act(() => hook.result.current.cancel())

    expect(composer().getScopedDraft(KEY_A)?.input).toBe('my draft')
    expect(composer().input).toBe('')
    expect(hook.result.current.edit).toBeNull()
  })

  it('says why it does not begin while this draft has work in flight or a prompt is open', async () => {
    const onToast = vi.fn()
    const hook = renderHook(() => useQueuedMessageEdit(SESSION_A, onToast))
    setDraftActivityForTests(KEY_A, { preparingAttachments: 1 })
    await act(() => hook.result.current.begin(QUEUED.id))
    setDraftActivityForTests(KEY_A, { pendingSubmissions: 1 })
    await act(() => hook.result.current.begin(QUEUED.id))
    useComposerActivityStore.setState({ drafts: {} })
    act(() => useBranchSummaryStore.setState({ prompt: fromPartial({ mode: 'choice' }) }))
    await act(() => hook.result.current.begin(QUEUED.id))

    expect(queueMock.beginEdit).not.toHaveBeenCalled()
    expect(onToast.mock.calls.map(([message]) => message)).toEqual([
      BEGIN_BLOCK_COPY.preparing,
      BEGIN_BLOCK_COPY.submitting,
      BEGIN_BLOCK_COPY['branch-summary'],
    ])
  })

  it('is not held up by work in flight for another draft', async () => {
    setDraftActivityForTests(KEY_A_OTHER_BRANCH, { pendingSubmissions: 1 })

    await renderOpenEdit()

    expect(queueMock.beginEdit).toHaveBeenCalledWith(QUEUED.id)
  })

  it('says why a save waits for a queued message to be acknowledged', async () => {
    const { hook, onToast } = await renderOpenEdit()
    setDraftActivityForTests(KEY_A, { pendingSubmissions: 1 })

    await act(() => hook.result.current.save())

    expect(queueMock.saveEdit).not.toHaveBeenCalled()
    expect(onToast).toHaveBeenCalledWith(SAVE_BUSY_COPY.submitting)
  })

  it('does not save while an attachment is still preparing', async () => {
    const { hook } = await renderOpenEdit()
    setDraftActivityForTests(KEY_A, { preparingAttachments: 1 })

    await act(() => hook.result.current.save())

    expect(queueMock.saveEdit).not.toHaveBeenCalled()
    expect(hook.result.current.edit).toMatchObject({ phase: 'editing' })
  })

  it('ignores a withdrawal while the save is in flight, then finishes the save', async () => {
    const { hook } = await renderOpenEdit()
    const pending = deferred()
    queueMock.saveEdit.mockReturnValueOnce(pending.promise)

    let saving: Promise<void> = Promise.resolve()
    act(() => {
      saving = hook.result.current.save()
    })
    act(() => hook.result.current.endWithdrawnEdit(QUEUED.id))
    expect(hook.result.current.edit).toMatchObject({ phase: 'saving' })

    await act(async () => {
      pending.resolve()
      await saving
    })
    expect(composer().input).toBe('my draft')
    expect(hook.result.current.edit).toBeNull()
  })

  it('ignores a withdrawal while the cancel is in flight', async () => {
    const { hook } = await renderOpenEdit()
    const pending = deferred()
    queueMock.cancelEdit.mockReturnValueOnce(pending.promise)

    let cancelling: Promise<void> = Promise.resolve()
    act(() => {
      cancelling = hook.result.current.cancel()
    })
    act(() => hook.result.current.endWithdrawnEdit(QUEUED.id))
    expect(hook.result.current.edit).toMatchObject({ phase: 'cancelling' })

    await act(async () => {
      pending.resolve()
      await cancelling
    })
    expect(composer().input).toBe('my draft')
  })

  it('keeps newly added attachments after the Host rejects a save, for a retry', async () => {
    const { hook, onToast } = await renderOpenEdit()
    act(() => composer().addAttachments([preparedAttachment('new-1')]))
    queueMock.saveEdit.mockRejectedValueOnce(
      new SessionControlRejectedError('queue-edit-save', 'queue_byte_capacity_reached'),
    )

    await act(() => hook.result.current.save())

    // The Host retains attachments a live hold's save named, so the retry can bind them again.
    expect(composer().attachments.map((attachment) => attachment.id)).toEqual(['host-1', 'new-1'])
    expect(hook.result.current.edit).toMatchObject({ phase: 'editing' })
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining('too large'))
    await act(() => hook.result.current.save())
    expect(queueMock.saveEdit).toHaveBeenLastCalledWith(
      openedEdit(QUEUED),
      expect.objectContaining({
        attachments: [
          expect.objectContaining({ id: 'host-1' }),
          expect.objectContaining({ id: 'new-1' }),
        ],
      }),
    )
  })
})

describe('useAdoptHeldQueuedMessageEdit', () => {
  beforeEach(() => {
    queueMock.fresh = null
    useComposerStore.setState(useComposerStore.getInitialState())
    useQueuedMessageEditStore.setState({ edits: {} })
  })

  it('reopens edit mode for a message this user holds when no edit is open for it', async () => {
    composer().switchScopedDraftContext(KEY_A)
    composer().setInput('my draft')
    queueMock.snapshot = snapshotOf([heldItem(QUEUED, 'hold-9')])

    renderHook(() => useAdoptHeldQueuedMessageEdit(SESSION_A))

    // Re-adopted through `resumeEdit`, carrying the revision the edit began at for its save.
    await waitFor(() =>
      expect(useQueuedMessageEditStore.getState().edits['session-a']).toMatchObject({
        phase: 'editing',
        followUpId: QUEUED.id,
        contextKey: KEY_A,
        based: { holdId: 'hold-9', queueRevision: BASE_QUEUE_REVISION },
      }),
    )
    expect(composer().input).toBe('queued text')
    expect(composer().getScopedDraft(queuedMessageEditStashKey('session-a'))?.input).toBe(
      'my draft',
    )
  })

  it('adopts once the Session draft becomes visible', async () => {
    composer().switchScopedDraftContext('project:/repo:session:session-b:main')
    queueMock.snapshot = snapshotOf([heldItem(QUEUED)])
    renderHook(() => useAdoptHeldQueuedMessageEdit(SESSION_A))
    await act(() => Promise.resolve())
    expect(useQueuedMessageEditStore.getState().edits).toEqual({})

    act(() => {
      composer().switchScopedDraftContext(KEY_A)
    })

    await waitFor(() =>
      expect(useQueuedMessageEditStore.getState().edits['session-a']).toMatchObject({
        contextKey: KEY_A,
      }),
    )
  })

  it('does not adopt a hold the refreshed queue no longer shows', async () => {
    composer().switchScopedDraftContext(KEY_A)
    queueMock.snapshot = snapshotOf([heldItem(QUEUED)])
    queueMock.fresh = snapshotOf([QUEUED])

    renderHook(() => useAdoptHeldQueuedMessageEdit(SESSION_A))
    await act(() => Promise.resolve())

    expect(useQueuedMessageEditStore.getState().edits).toEqual({})
  })

  it('leaves a hold alone when it is not this user’s', async () => {
    composer().switchScopedDraftContext(KEY_A)
    queueMock.snapshot = snapshotOf([
      { ...QUEUED, editHold: { heldByCurrentUser: false, acquiredAt: 1, leaseExpiresAt: 2 } },
    ])

    renderHook(() => useAdoptHeldQueuedMessageEdit(SESSION_A))
    await act(() => Promise.resolve())

    expect(useQueuedMessageEditStore.getState().edits).toEqual({})
  })
})
