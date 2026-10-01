import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openedEdit, queueItem } from '../../hooks/__tests__/queued-message-edit.test-support'
import { useComposerStore } from '../composer-store'
import {
  isHoldAbandoned,
  queuedMessageEditStashKey,
  useQueuedMessageEditStore,
} from '../queued-message-edit-store'

const ipc = vi.hoisted(() => ({
  mutateSessionControl: vi.fn(),
  discardPreparedAttachment: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: ipc }))

const QUEUED = queueItem({ id: 'follow-up-1' })
const BRANCH_KEY = 'project:/repo:session:session-a:branch:feature'
const STASH_KEY = queuedMessageEditStashKey('session-a')

function openEditIn(contextKey: string) {
  useComposerStore.getState().saveScopedDraft(contextKey, { input: 'edited', attachments: [] })
  useComposerStore.getState().saveScopedDraft(STASH_KEY, { input: 'my draft', attachments: [] })
  useQueuedMessageEditStore.getState().setEdit('session-a', {
    phase: 'editing',
    followUpId: QUEUED.id,
    contextKey,
    based: openedEdit(QUEUED),
  })
}

function cancelCommands() {
  return ipc.mutateSessionControl.mock.calls.map(([request]) => request.command)
}

describe('clearing the drafts of a queued-message edit', () => {
  beforeEach(() => {
    useComposerStore.setState(useComposerStore.getInitialState())
    useQueuedMessageEditStore.setState({ edits: {} })
    ipc.mutateSessionControl.mockReset().mockResolvedValue({ outcome: { effect: 'queue-updated' } })
  })

  it('releases the hold and drops the stash when the branch holding the edit is archived', () => {
    openEditIn(BRANCH_KEY)

    useComposerStore.getState().clearScopedDraftsForBranch('session-a', 'feature')

    expect(cancelCommands()).toEqual([
      {
        operation: 'queue-edit-cancel',
        sessionId: 'session-a',
        followUpId: QUEUED.id,
        holdId: 'hold-1',
      },
    ])
    expect(useQueuedMessageEditStore.getState().edits).toEqual({})
    expect(useComposerStore.getState().getScopedDraft(STASH_KEY)).toBeNull()
  })

  it('releases the hold when the Session is deleted or archived', () => {
    openEditIn('project:/repo:session:session-a:main')

    useComposerStore.getState().clearScopedDraftsForSession('session-a')

    expect(cancelCommands()).toHaveLength(1)
    expect(useQueuedMessageEditStore.getState().edits).toEqual({})
    expect(useComposerStore.getState().getScopedDraft(STASH_KEY)).toBeNull()
  })

  it('leaves an edit in another branch alone', () => {
    openEditIn('project:/repo:session:session-a:branch:main')

    useComposerStore.getState().clearScopedDraftsForBranch('session-a', 'feature')

    expect(cancelCommands()).toEqual([])
    expect(useQueuedMessageEditStore.getState().edits['session-a']).toBeDefined()
    expect(useComposerStore.getState().getScopedDraft(STASH_KEY)?.input).toBe('my draft')
  })

  it('lets adoption take the hold up again when the release never reaches the Host', async () => {
    ipc.mutateSessionControl.mockReset().mockRejectedValue(new Error('Host connection lost'))
    openEditIn(BRANCH_KEY)

    useComposerStore.getState().clearScopedDraftsForBranch('session-a', 'feature')
    expect(isHoldAbandoned('hold-1')).toBe(true)

    await vi.waitFor(() => expect(isHoldAbandoned('hold-1')).toBe(false))
  })
})
