import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHookWithQueryClient } from '@/test-utils/query-test-utils'
import { isLostFollowUpEdit, useSessionFollowUpQueue } from '../useSessionFollowUpQueue'
import { SESSION_ID } from './session-follow-up-queue.test-fixtures'

const apiMocks = vi.hoisted(() => ({
  querySessionControl: vi.fn(),
  mutateSessionControl: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMocks }))

const WAGGLE = {
  presetId: 'preset-review',
  presetName: 'Review pair',
  source: 'user',
  config: {
    mode: 'sequential',
    agents: [
      { label: 'Builder', model: '$inherit', roleDescription: 'Builds', color: 'blue' },
      { label: 'Reviewer', model: 'openai/gpt-5', roleDescription: 'Reviews', color: 'amber' },
    ],
    stop: { primary: 'consensus', maxTurnsSafety: 4 },
  },
}

function queue(editHold?: unknown) {
  return {
    contractVersion: 2,
    requestId: 'query',
    outcome: {
      operation: 'queue-list',
      sessionId: SESSION_ID,
      queueState: 'running',
      queueRevision: 7,
      activeRunId: 'run-1',
      items: [
        {
          followUpId: 'follow-up-1',
          position: 0,
          createdAt: 10,
          deliveryState: 'pending',
          intent: {
            text: 'Queued text',
            attachmentIds: ['attachment-1'],
            thinkingLevel: 'high',
            waggle: WAGGLE,
            callerId: 'gui:local-user',
          },
          editable: true,
          attachments: [
            {
              id: 'attachment-1',
              kind: 'text',
              origin: 'user-file',
              name: 'notes.txt',
              mimeType: 'text/plain',
              sizeBytes: 4,
            },
          ],
          ...(editHold ? { editHold } : {}),
        },
      ],
      omittedBodyCount: 0,
    },
  }
}

function respond(outcome: unknown) {
  apiMocks.mutateSessionControl.mockImplementationOnce(async (request) => ({
    contractVersion: 2,
    requestId: request.requestId,
    idempotencyKey: request.idempotencyKey,
    replayed: false,
    outcome,
  }))
}

const HELD = {
  holdId: 'hold-1',
  holderIsCaller: true,
  acquiredAt: 100,
  leaseExpiresAt: 30_100,
}

describe('useSessionFollowUpQueue Follow-up edits', () => {
  beforeEach(() => {
    apiMocks.querySessionControl.mockReset().mockResolvedValue(queue())
    apiMocks.mutateSessionControl.mockReset()
  })

  it('projects editability, the hold, attachments, and the full Waggle invocation', async () => {
    apiMocks.querySessionControl.mockResolvedValue(queue(HELD))
    const { result } = renderHookWithQueryClient(() => useSessionFollowUpQueue(SESSION_ID))
    await waitFor(() => expect(result.current.snapshot.items).toHaveLength(1))

    expect(result.current.snapshot.items[0]).toMatchObject({
      editable: true,
      editHold: { holdId: 'hold-1', heldByCurrentUser: true, leaseExpiresAt: 30_100 },
      attachments: [{ id: 'attachment-1', name: 'notes.txt', mimeType: 'text/plain' }],
      waggle: { presetId: 'preset-review', config: { mode: 'sequential' } },
    })
  })

  it('begins an edit, then saves the content in place with the latest queue revision', async () => {
    const { result } = renderHookWithQueryClient(() => useSessionFollowUpQueue(SESSION_ID))
    await waitFor(() => expect(result.current.snapshot.items).toHaveLength(1))
    respond({
      operation: 'queue-edit-begin',
      effect: 'follow-up-edit-held',
      sessionId: SESSION_ID,
      followUpId: 'follow-up-1',
      holdId: 'hold-1',
      leaseExpiresAt: 30_100,
      queueRevision: 8,
      stateRevision: 9,
    })
    apiMocks.querySessionControl.mockResolvedValue(queue(HELD))

    let edit: Awaited<ReturnType<typeof result.current.beginEdit>> | undefined
    await act(async () => {
      edit = await result.current.beginEdit('follow-up-1')
    })
    expect(edit).toMatchObject({
      followUpId: 'follow-up-1',
      holdId: 'hold-1',
      item: { text: 'Queued text', attachments: [{ id: 'attachment-1' }] },
    })

    respond({
      operation: 'queue-edit-save',
      effect: 'queue-updated',
      sessionId: SESSION_ID,
      queueState: 'running',
      queueRevision: 9,
      followUpIds: ['follow-up-1'],
      stateRevision: 10,
    })
    await act(() =>
      result.current.saveEdit(
        { followUpId: 'follow-up-1', holdId: 'hold-1' },
        { text: 'Edited', attachments: [{ id: 'attachment-1' }, { id: 'attachment-2' }] },
      ),
    )
    expect(apiMocks.mutateSessionControl).toHaveBeenLastCalledWith(
      expect.objectContaining({
        command: {
          operation: 'queue-edit-save',
          sessionId: SESSION_ID,
          followUpId: 'follow-up-1',
          holdId: 'hold-1',
          expectedQueueRevision: 7,
          input: { text: 'Edited', attachmentIds: ['attachment-1', 'attachment-2'] },
        },
      }),
    )
  })

  it('refuses a GUI-only composer command and reports a lost hold', async () => {
    const { result } = renderHookWithQueryClient(() => useSessionFollowUpQueue(SESSION_ID))
    await waitFor(() => expect(result.current.snapshot.items).toHaveLength(1))
    const edit = { followUpId: 'follow-up-1', holdId: 'hold-1' }

    await expect(
      result.current.saveEdit(edit, { text: '/compact', attachments: [] }),
    ).rejects.toThrow()
    expect(apiMocks.mutateSessionControl).not.toHaveBeenCalled()

    respond({
      operation: 'queue-edit-save',
      effect: 'rejected',
      sessionId: SESSION_ID,
      code: 'follow_up_edit_not_held',
    })
    const failure = await result.current
      .saveEdit(edit, { text: 'Edited', attachments: [] })
      .catch((error: unknown) => error)
    expect(isLostFollowUpEdit(failure)).toBe(true)
  })

  it('cancels an edit by its hold', async () => {
    const { result } = renderHookWithQueryClient(() => useSessionFollowUpQueue(SESSION_ID))
    await waitFor(() => expect(result.current.snapshot.items).toHaveLength(1))
    respond({
      operation: 'queue-edit-cancel',
      effect: 'queue-updated',
      sessionId: SESSION_ID,
      queueState: 'running',
      queueRevision: 8,
      followUpIds: ['follow-up-1'],
      stateRevision: 9,
    })

    await act(() => result.current.cancelEdit({ followUpId: 'follow-up-1', holdId: 'hold-1' }))
    expect(apiMocks.mutateSessionControl).toHaveBeenCalledWith(
      expect.objectContaining({
        command: {
          operation: 'queue-edit-cancel',
          sessionId: SESSION_ID,
          followUpId: 'follow-up-1',
          holdId: 'hold-1',
        },
      }),
    )
  })
})
