import { SessionId } from '@shared/types/brand'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  pendingChangeRequestOutput,
  pendingCommitOutput,
} from '../../application/session-change-request-output-retry'
import {
  getSessionResourceHandlerMocks,
  invokeSessionResourceHandler as invoke,
  resetSessionResourceHandlerHarness,
  sessionResourceBackfillPageSize,
} from './session-resource-handler.test-harness'

const handlerMocks = getSessionResourceHandlerMocks()

function emptyProjectionPage(hasMore: boolean) {
  return { nodes: [], throughCreatedOrder: 41, hasMore }
}

describe('session resource IPC handlers', () => {
  beforeEach(() => {
    resetSessionResourceHandlerHarness()
  })

  it('rejects malformed and traversal-like session/resource identifiers at the IPC boundary', async () => {
    await expect(invoke('sessions:resources:list', '../another-session')).rejects.toBeDefined()
    await expect(
      invoke('sessions:resources:read', SessionId('session-one'), '../../secret'),
    ).rejects.toBeDefined()
    await expect(
      invoke('sessions:resources:thumbnail', SessionId('session-one'), '../../secret'),
    ).rejects.toBeDefined()
    await expect(
      invoke('sessions:resources:retry', SessionId('session-one'), '../../secret'),
    ).rejects.toBeDefined()
    expect(handlerMocks.list).not.toHaveBeenCalled()
    expect(handlerMocks.getContentLocation).not.toHaveBeenCalled()
  })

  it('rejects arbitrary change-request Output recording without a main-process retry grant', async () => {
    await expect(
      invoke('sessions:resources:record-change-request', SessionId('session-one'), {
        title: 'Unbound request',
        url: 'https://github.com/openwaggle/openwaggle/pull/999',
      }),
    ).rejects.toThrow('No matching created change request')
  })

  it('treats an already-recorded session change request as a successful Output retry', async () => {
    const sessionId = SessionId('session-one')
    const existing = {
      id: 'recorded-pr',
      sessionId,
      canonicalKey: 'url:https://github.com/openwaggle/openwaggle/pull/42',
      kind: 'change-request' as const,
      title: 'Complete resource hub',
      mimeType: null,
      locator: 'https://github.com/openwaggle/openwaggle/pull/42',
      managed: false,
      available: true,
      isSource: false,
      isOutput: true,
      occurrences: [],
      createdAt: 1,
      updatedAt: 1,
    }
    handlerMocks.list.mockReturnValue([existing])

    await expect(
      invoke('sessions:resources:record-change-request', sessionId, {
        title: existing.title,
        url: existing.locator,
      }),
    ).resolves.toEqual(existing)

    expect(handlerMocks.list).toHaveBeenCalledWith(sessionId)
    expect(handlerMocks.upsert).not.toHaveBeenCalled()
  })

  it('retries a pending commit Output when its originating Session Summary refreshes', async () => {
    const sessionId = SessionId('session-one')
    const commit = { commitHash: 'abc123', summary: 'Complete resource hub' }
    handlerMocks.pendingOutputs.push(
      pendingCommitOutput(sessionId, commit, {
        nodeId: 'node-at-commit',
        branchId: 'branch-at-commit',
        createdAt: 1000,
      }),
    )

    await invoke('sessions:resources:list', sessionId)

    expect(handlerMocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        kind: 'commit',
        canonicalKey: 'commit:abc123',
        createdAt: 1000,
        occurrence: expect.objectContaining({
          nodeId: 'node-at-commit',
          branchId: 'branch-at-commit',
          createdAt: 1000,
        }),
      }),
    )
    expect(handlerMocks.pendingOutputs).toEqual([])
  })

  it('reuses a pending change request Output provenance during manual retry', async () => {
    const sessionId = SessionId('session-one')
    const request = {
      title: 'Complete resource hub',
      url: 'https://github.com/openwaggle/openwaggle/pull/42',
    }
    handlerMocks.pendingOutputs.push(
      pendingChangeRequestOutput(sessionId, request, {
        nodeId: 'node-at-request',
        branchId: 'branch-at-request',
        createdAt: 2000,
      }),
    )

    await invoke('sessions:resources:record-change-request', sessionId, request)

    expect(handlerMocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        kind: 'change-request',
        createdAt: 2000,
        occurrence: expect.objectContaining({
          nodeId: 'node-at-request',
          branchId: 'branch-at-request',
          createdAt: 2000,
        }),
      }),
    )
    expect(handlerMocks.pendingOutputs).toEqual([])
  })

  it('rejects invalid change-request metadata at the IPC boundary', async () => {
    await expect(
      invoke('sessions:resources:record-change-request', SessionId('session-one'), {
        title: ' ',
        url: 'javascript:alert(1)',
      }),
    ).rejects.toBeDefined()
  })

  it('passes validated identifiers to the session-scoped repository lookup', async () => {
    await expect(
      invoke('sessions:resources:read', SessionId('session-one'), 'resource-one'),
    ).resolves.toBeNull()
    expect(handlerMocks.getContentLocation).toHaveBeenCalledWith(
      SessionId('session-one'),
      'resource-one',
    )
    expect(handlerMocks.list).toHaveBeenCalledWith(SessionId('session-one'))
  })

  it('backfills one persisted page instead of hydrating the complete session tree', async () => {
    handlerMocks.getBackfillCursor.mockReturnValue(23)
    handlerMocks.listResourceProjectionPage.mockReturnValue(emptyProjectionPage(false))

    await expect(invoke('sessions:resources:list', SessionId('session-one'))).resolves.toEqual({
      resources: [],
      backfillComplete: true,
      progressed: true,
    })

    expect(handlerMocks.listResourceProjectionPage).toHaveBeenCalledWith(
      SessionId('session-one'),
      23,
      sessionResourceBackfillPageSize(),
    )
    expect(handlerMocks.advanceBackfillCursor).toHaveBeenCalledWith(SessionId('session-one'), 41)
  })

  it('keeps polling after a fully projected page when persisted history remains', async () => {
    handlerMocks.listResourceProjectionPage.mockReturnValue(emptyProjectionPage(true))

    await expect(invoke('sessions:resources:list', SessionId('session-one'))).resolves.toEqual({
      resources: [],
      backfillComplete: false,
      progressed: true,
    })

    expect(handlerMocks.advanceBackfillCursor).toHaveBeenCalledWith(SessionId('session-one'), 41)
    handlerMocks.list.mockClear()
    await expect(invoke('sessions:resources:backfill', SessionId('session-one'))).resolves.toEqual({
      backfillComplete: false,
      progressed: true,
    })
    expect(handlerMocks.list).toHaveBeenCalledOnce()
  })

  it('looks up retry provenance only inside the requested session', async () => {
    handlerMocks.list.mockReturnValue([
      {
        id: 'resource-one',
        sessionId: SessionId('session-one'),
        canonicalKey: 'file:/input/missing.png',
        kind: 'image',
        title: 'missing.png',
        mimeType: 'image/png',
        locator: '/input/missing.png',
        available: false,
        isSource: true,
        isOutput: false,
        occurrences: [
          {
            id: 'occurrence-one',
            nodeId: 'node-one',
            branchId: null,
            actor: 'user',
            activity: 'provided',
            label: null,
            createdAt: 1,
          },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    await expect(
      invoke('sessions:resources:retry', SessionId('session-one'), 'resource-one'),
    ).resolves.toBeUndefined()

    expect(handlerMocks.list).toHaveBeenCalledWith(SessionId('session-one'))
    expect(handlerMocks.getResourceProjectionNodes).toHaveBeenCalledOnce()
  })

  it('does not advance the page cursor when a capture budget leaves work pending', async () => {
    const markdown = Array.from(
      { length: 33 },
      (_, index) => `[Link](https://example.test/${String(index)})`,
    ).join('\n')
    handlerMocks.listResourceProjectionPage.mockReturnValue({
      nodes: [
        {
          id: 'assistant-node',
          branchId: null,
          message: {
            id: 'assistant-node',
            role: 'assistant',
            parts: [{ type: 'text', text: markdown }],
            createdAt: 1000,
          },
        },
      ],
      throughCreatedOrder: 41,
      hasMore: false,
    })

    await expect(invoke('sessions:resources:list', SessionId('session-one'))).resolves.toEqual({
      resources: [],
      backfillComplete: false,
      progressed: true,
    })

    expect(handlerMocks.advanceBackfillCursor).not.toHaveBeenCalled()
  })

  it('keeps polling the same page after a transient capture failure', async () => {
    handlerMocks.listResourceProjectionPage.mockReturnValue({
      nodes: [
        {
          id: 'assistant-node',
          branchId: null,
          message: {
            id: 'assistant-node',
            role: 'assistant',
            parts: [{ type: 'text', text: '[Docs](https://example.test/docs)' }],
            createdAt: 1000,
          },
        },
      ],
      throughCreatedOrder: 41,
      hasMore: false,
    })
    handlerMocks.list
      .mockImplementationOnce(() => {
        throw new Error('database temporarily unavailable')
      })
      .mockReturnValue([])

    await expect(invoke('sessions:resources:list', SessionId('session-one'))).resolves.toEqual({
      resources: [],
      backfillComplete: false,
      progressed: false,
    })

    expect(handlerMocks.advanceBackfillCursor).not.toHaveBeenCalled()
  })

  it('returns a bounded thumbnail for managed content in the requested session', async () => {
    handlerMocks.getContentLocation.mockReturnValue({
      resourceId: 'resource-one',
      sessionId: SessionId('session-one'),
      fileName: 'image.png',
      mimeType: 'image/png',
      managedPath: '/managed/image.png',
    })

    await expect(
      invoke('sessions:resources:thumbnail', SessionId('session-one'), 'resource-one'),
    ).resolves.toEqual({
      resourceId: 'resource-one',
      fileName: 'resource-one-thumbnail.webp',
      mimeType: 'image/webp',
      dataBase64: Buffer.from('thumbnail').toString('base64'),
    })
    expect(handlerMocks.getContentLocation).toHaveBeenCalledWith(
      SessionId('session-one'),
      'resource-one',
    )
    expect(handlerMocks.read).toHaveBeenCalledWith('/managed/image.png')
    expect(handlerMocks.thumbnail).toHaveBeenCalledWith(Buffer.from('full-image'), 'image/png')
  })
})
