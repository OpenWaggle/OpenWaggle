import { SessionId } from '@shared/types/brand'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SessionControlRejectedError,
  type SessionFollowUpQueueSnapshot,
} from '@/features/chat/hooks'
import { isHostReferencedAttachment } from '../../state/composer-attachment-lifecycle'
import { useComposerStore } from '../../state/composer-store'
import {
  queuedMessageEditStashKey,
  useQueuedMessageEditStore,
} from '../../state/queued-message-edit-store'
import { LOST_EDIT_MESSAGE } from '../queued-message-edit-messages'
import { useQueuedMessageEdit } from '../useQueuedMessageEdit'
import {
  openedEdit,
  preparedAttachment,
  queueItem,
  REVIEW_PRESET,
  REVIEW_WAGGLE,
  snapshotOf,
} from './queued-message-edit.test-support'

const queueMock = vi.hoisted(() => {
  const mock: { snapshot: SessionFollowUpQueueSnapshot } & Record<
    'beginEdit' | 'saveEdit' | 'cancelEdit' | 'discard',
    ReturnType<typeof vi.fn>
  > = {
    snapshot: { state: 'running', revision: 1, activeRunId: null, items: [], waitingOnEdit: false },
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

vi.mock('@/features/chat/hooks/useSessionFollowUpQueue', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSessionFollowUpQueue: () => ({
    snapshot: queueMock.snapshot,
    beginEdit: queueMock.beginEdit,
    saveEdit: queueMock.saveEdit,
    cancelEdit: queueMock.cancelEdit,
  }),
}))

const SESSION_A = SessionId('session-a')
const KEY_A = 'project:/repo:session:session-a:main'
const KEY_B = 'project:/repo:session:session-b:main'
const VISUALIZATION = { title: 'Map', sourcePath: '/repo/map.html', state: { zoom: 2 } }
const QUEUED = queueItem({
  id: 'follow-up-1',
  text: 'queued text',
  attachments: [
    {
      id: 'host-1',
      kind: 'text',
      origin: 'session-resource',
      name: 'notes.txt',
      mimeType: 'text/plain',
      sizeBytes: 12,
    },
  ],
  waggle: REVIEW_WAGGLE,
  visualizationContext: VISUALIZATION,
})
const DRAFT_ATTACHMENT = preparedAttachment('draft-1')

function composer() {
  return useComposerStore.getState()
}

function setDraft(input: string) {
  composer().setInput(input)
  composer().replaceAttachments([DRAFT_ATTACHMENT])
  composer().setSelectedWagglePreset(REVIEW_PRESET)
}

function renderEdit() {
  const onToast = vi.fn()
  const hook = renderHook(() => useQueuedMessageEdit(SESSION_A, onToast))
  return { hook, onToast }
}

async function beginEdit(hook: ReturnType<typeof renderEdit>['hook']) {
  queueMock.beginEdit.mockResolvedValueOnce(openedEdit(QUEUED))
  await act(() => hook.result.current.begin(QUEUED.id))
}

describe('useQueuedMessageEdit', () => {
  beforeEach(() => {
    useComposerStore.setState(useComposerStore.getInitialState())
    useQueuedMessageEditStore.setState({ edits: {} })
    composer().switchScopedDraftContext(KEY_A)
    queueMock.snapshot = snapshotOf([QUEUED])
    queueMock.beginEdit.mockReset()
    queueMock.saveEdit.mockReset().mockResolvedValue(undefined)
    queueMock.cancelEdit.mockReset().mockResolvedValue(undefined)
    queueMock.discard.mockReset().mockResolvedValue(undefined)
  })

  it('sets the draft aside and loads the queued text, attachment chips, and Waggle chip', async () => {
    setDraft('my draft')
    const { hook } = renderEdit()
    await beginEdit(hook)

    expect(composer().input).toBe('queued text')
    expect(composer().attachments.map((attachment) => attachment.id)).toEqual(['host-1'])
    expect(composer().selectedWagglePreset?.id).toBe('review')
    expect(composer().getScopedDraft(queuedMessageEditStashKey('session-a'))).toMatchObject({
      input: 'my draft',
      attachments: [DRAFT_ATTACHMENT],
    })
    expect(hook.result.current.edit).toMatchObject({
      phase: 'editing',
      followUpId: QUEUED.id,
      contextKey: KEY_A,
    })
    expect(hook.result.current.isVisible).toBe(true)
  })

  it('saves against the edit beginEdit returned, then restores the exact draft', async () => {
    setDraft('my draft')
    const { hook } = renderEdit()
    await beginEdit(hook)
    act(() => composer().setInput('  edited text '))

    await act(() => hook.result.current.save())

    expect(queueMock.saveEdit).toHaveBeenCalledWith(openedEdit(QUEUED), {
      text: 'edited text',
      attachments: [expect.objectContaining({ id: 'host-1' })],
      waggle: REVIEW_WAGGLE,
      visualizationContext: VISUALIZATION,
    })
    expect(composer().input).toBe('my draft')
    expect(composer().attachments).toEqual([DRAFT_ATTACHMENT])
    expect(composer().selectedWagglePreset?.id).toBe('review')
    expect(composer().getScopedDraft(queuedMessageEditStashKey('session-a'))).toBeNull()
    expect(hook.result.current.edit).toBeNull()
    // The queued message still references its attachment: leaving the composer must not discard it.
    expect(queueMock.discard).not.toHaveBeenCalled()
  })

  it('drops the Waggle invocation when its chip is removed', async () => {
    const { hook } = renderEdit()
    await beginEdit(hook)
    act(() => composer().setSelectedWagglePreset(null))

    await act(() => hook.result.current.save())

    expect(queueMock.saveEdit.mock.calls[0]?.[1]).not.toHaveProperty('waggle')
  })

  it('keeps the edited text as a new draft when the edit was lost', async () => {
    setDraft('my draft')
    const { hook, onToast } = renderEdit()
    await beginEdit(hook)
    act(() => composer().setInput('edited text'))
    queueMock.saveEdit.mockRejectedValueOnce(
      new SessionControlRejectedError('queue-edit-save', 'follow_up_edit_not_held'),
    )

    await act(() => hook.result.current.save())

    expect(composer().input).toBe('edited text\n\nmy draft')
    // The Host keeps the edit's attachments bindable, so they come along to be sent as new.
    expect(composer().attachments.map((attachment) => attachment.id)).toEqual(['host-1', 'draft-1'])
    expect(hook.result.current.edit).toBeNull()
    expect(onToast).toHaveBeenCalledWith(LOST_EDIT_MESSAGE)
    // Removing a kept Host attachment's chip must not discard what the Host still holds.
    act(() => composer().removeAttachment('host-1'))
    expect(queueMock.discard).not.toHaveBeenCalled()
  })

  it('stays in edit mode with the edit intact when a save fails for another reason', async () => {
    const { hook, onToast } = renderEdit()
    await beginEdit(hook)
    act(() => composer().setInput('edited text'))
    queueMock.saveEdit.mockRejectedValueOnce(
      new SessionControlRejectedError('queue-edit-save', 'queue_byte_capacity_reached'),
    )

    await act(() => hook.result.current.save())

    expect(hook.result.current.edit).toMatchObject({ phase: 'editing' })
    expect(composer().input).toBe('edited text')
    expect(composer().attachments.map((attachment) => attachment.id)).toEqual(['host-1'])
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining('too large'))
  })

  it('cancels the hold and restores the draft', async () => {
    setDraft('my draft')
    const { hook } = renderEdit()
    await beginEdit(hook)
    act(() => composer().setInput('discard me'))

    await act(() => hook.result.current.cancel())

    expect(queueMock.cancelEdit).toHaveBeenCalledWith(openedEdit(QUEUED))
    expect(composer().input).toBe('my draft')
    expect(composer().attachments).toEqual([DRAFT_ATTACHMENT])
    expect(hook.result.current.edit).toBeNull()
    expect(queueMock.discard).not.toHaveBeenCalled()
    // Protected only while the edit had them in the composer.
    expect(isHostReferencedAttachment({ id: 'host-1' })).toBe(false)
  })

  it('reports a refused begin and leaves the draft alone', async () => {
    setDraft('my draft')
    const { hook, onToast } = renderEdit()
    queueMock.beginEdit.mockRejectedValueOnce(
      new SessionControlRejectedError('queue-edit-begin', 'follow_up_edit_held'),
    )

    await act(() => hook.result.current.begin(QUEUED.id))

    expect(onToast).toHaveBeenCalledWith('This queued message is already being edited.')
    expect(composer().input).toBe('my draft')
    expect(hook.result.current.edit).toBeNull()
  })

  it('opens one edit at a time per Session', async () => {
    const { hook } = renderEdit()
    await beginEdit(hook)

    await act(() => hook.result.current.begin('follow-up-2'))

    expect(queueMock.beginEdit).toHaveBeenCalledTimes(1)
  })

  it('keeps the edit open across a Session switch and back', async () => {
    setDraft('my draft')
    const { hook } = renderEdit()
    await beginEdit(hook)
    act(() => composer().setInput('half edited'))

    act(() => {
      composer().switchScopedDraftContext(KEY_B)
    })
    expect(composer().input).toBe('')
    act(() => {
      composer().switchScopedDraftContext(KEY_A)
    })

    expect(hook.result.current.edit).toMatchObject({ phase: 'editing', followUpId: QUEUED.id })
    expect(composer().input).toBe('half edited')
    await act(() => hook.result.current.save())
    expect(composer().input).toBe('my draft')
  })
})
