import type { PreparedAttachment } from '@shared/types/agent'
import { SessionId } from '@shared/types/brand'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionFollowUpQueueSnapshot } from '@/features/chat/hooks'
import { useComposerStore } from '../../state/composer-store'
import { useQueuedMessageEditStore } from '../../state/queued-message-edit-store'
import { useAdoptHeldQueuedMessageEdit, useQueuedMessageEdit } from '../useQueuedMessageEdit'
import {
  heldItem,
  openedEdit,
  queueItem,
  resumeFrom,
  snapshotOf,
} from './queued-message-edit.test-support'

const queueMock = vi.hoisted(() => {
  const mock: { snapshot: SessionFollowUpQueueSnapshot } & Record<
    'beginEdit' | 'saveEdit' | 'cancelEdit' | 'adoptEdit' | 'discard' | 'mutateSessionControl',
    ReturnType<typeof vi.fn>
  > = {
    snapshot: { state: 'running', revision: 1, activeRunId: null, items: [], waitingOnEdit: false },
    beginEdit: vi.fn(),
    saveEdit: vi.fn(),
    cancelEdit: vi.fn(),
    adoptEdit: vi.fn(),
    discard: vi.fn(),
    mutateSessionControl: vi.fn(),
  }
  return mock
})

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    discardPreparedAttachment: queueMock.discard,
    mutateSessionControl: queueMock.mutateSessionControl,
  },
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
      ...resumeFrom(queueMock.snapshot, actual.heldEdit),
      adoptEdit: queueMock.adoptEdit,
    }),
  }
})

const SESSION_A = SessionId('session-a')
const MAIN_KEY = 'project:/repo:session:session-a:branch:main'
const FEATURE_KEY = 'project:/repo:session:session-a:branch:feature'
const QUEUED = queueItem({ id: 'follow-up-1', text: 'queued text' })
const ADDED: PreparedAttachment = {
  id: 'added-1',
  kind: 'image',
  origin: 'session-resource',
  name: 'added.png',
  path: '/tmp/added.png',
  mimeType: 'image/png',
  sizeBytes: 3,
  extractedText: '',
}

function composer() {
  return useComposerStore.getState()
}

describe('ending a queued-message edit', () => {
  beforeEach(() => {
    useComposerStore.setState(useComposerStore.getInitialState())
    useQueuedMessageEditStore.setState({ edits: {} })
    queueMock.snapshot = snapshotOf([QUEUED])
    queueMock.beginEdit.mockReset()
    queueMock.saveEdit.mockReset().mockResolvedValue(undefined)
    queueMock.cancelEdit.mockReset().mockResolvedValue(undefined)
    queueMock.adoptEdit.mockReset().mockResolvedValue(true)
    queueMock.discard.mockReset().mockResolvedValue(undefined)
    queueMock.mutateSessionControl.mockReset().mockResolvedValue({})
  })

  it('does not re-adopt a hold its archived branch gave up before the Host releases it', async () => {
    composer().switchScopedDraftContext(MAIN_KEY)
    useQueuedMessageEditStore.getState().setEdit('session-a', {
      phase: 'editing',
      followUpId: QUEUED.id,
      contextKey: FEATURE_KEY,
      based: openedEdit(QUEUED, 'hold-7'),
    })
    act(() => composer().clearScopedDraftsForBranch('session-a', 'feature'))
    // The release is still on its way: the queue keeps showing the hold as this user's.
    queueMock.snapshot = snapshotOf([heldItem(QUEUED, 'hold-7')])

    renderHook(() => useAdoptHeldQueuedMessageEdit(SESSION_A))
    await act(() => Promise.resolve())

    expect(queueMock.adoptEdit).not.toHaveBeenCalled()
    expect(useQueuedMessageEditStore.getState().edits).toEqual({})
  })

  it('protects attachments added during the edit when a successful save restores the draft', async () => {
    composer().switchScopedDraftContext(MAIN_KEY)
    const hook = renderHook(() => useQueuedMessageEdit(SESSION_A, vi.fn()))
    queueMock.beginEdit.mockResolvedValueOnce(openedEdit(QUEUED))
    await act(() => hook.result.current.begin(QUEUED.id))
    act(() => composer().addAttachments([ADDED]))

    await act(() => hook.result.current.save())

    expect(queueMock.saveEdit).toHaveBeenCalledWith(
      openedEdit(QUEUED),
      expect.objectContaining({ attachments: [expect.objectContaining({ id: ADDED.id })] }),
    )
    // The queued message now carries it: leaving the composer must not discard it.
    expect(composer().attachments).toEqual([])
    expect(queueMock.discard).not.toHaveBeenCalled()
  })
})
