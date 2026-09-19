import { SessionId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pendingCommitOutput } from '../../application/session-change-request-output-retry'
import {
  clearPendingSessionOutputRetry,
  SESSION_OUTPUT_RETRY_BACKOFF_MS,
} from '../../application/session-output-retry-backoff'
import { subscribeToSessionResourceInvalidations } from '../../application/session-resource-invalidation'
import { SessionResourceRepositoryError } from '../../errors'
import {
  getSessionResourceHandlerMocks,
  invokeSessionResourceHandler as invoke,
  resetSessionResourceHandlerHarness,
} from './session-resource-handler.test-harness'

const handlerMocks = getSessionResourceHandlerMocks()
const SESSION_ONE = SessionId('session-one')

describe('session resource catalog IPC handlers', () => {
  afterEach(() => {
    clearPendingSessionOutputRetry(SESSION_ONE)
    vi.useRealTimers()
  })

  beforeEach(() => {
    resetSessionResourceHandlerHarness()
  })

  it('passes validated identifiers to the session-scoped content lookup', async () => {
    await expect(
      invoke('sessions:resources:read', SessionId('session-one'), 'resource-one'),
    ).resolves.toBeNull()
    expect(handlerMocks.getContentLocation).toHaveBeenCalledWith(
      SessionId('session-one'),
      'resource-one',
    )
  })

  it('returns an opaque protocol reference without serializing managed bytes', async () => {
    handlerMocks.getContentLocation.mockReturnValue({
      resourceId: 'resource-one',
      sessionId: SESSION_ONE,
      fileName: 'image.png',
      mimeType: 'image/png',
      managedPath: '/managed/image.png',
    })

    const content = await invoke('sessions:resources:read', SESSION_ONE, 'resource-one')

    expect(content).toMatchObject({
      resourceId: 'resource-one',
      fileName: 'image.png',
      mimeType: 'image/png',
      url: expect.stringMatching(/^openwaggle-session-resource:\/\/content\//u),
      downloadUrl: expect.stringMatching(/^openwaggle-session-resource:\/\/content\//u),
    })
    expect(content).not.toHaveProperty('dataBase64')
    expect(handlerMocks.read).not.toHaveBeenCalled()
  })

  it('drains a durable pending Output before serving the modern catalog page', async () => {
    const sessionId = SESSION_ONE
    handlerMocks.listPage.mockReturnValue({
      resources: [],
      total: 0,
      nextCursor: null,
      orderRevision: 'revision-one',
    })
    handlerMocks.pendingOutputs.push(
      pendingCommitOutput(
        sessionId,
        { commitHash: 'abc123', summary: 'Complete resource hub' },
        { nodeId: 'node-one', branchId: 'branch-one', createdAt: 1_000 },
      ),
    )

    await expect(
      invoke('sessions:resources:page', sessionId, { view: 'outputs', limit: 6 }),
    ).resolves.toMatchObject({ resources: [], total: 0 })

    expect(handlerMocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId, canonicalKey: 'commit:abc123' }),
    )
    expect(handlerMocks.pendingOutputs).toEqual([])
    expect(handlerMocks.upsert.mock.invocationCallOrder[0]).toBeLessThan(
      handlerMocks.listPage.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )
  })

  it('backs off per Session until a pending Output persists after two failed drains', async () => {
    vi.useFakeTimers()
    const failure = new SessionResourceRepositoryError({
      operation: 'upsert',
      cause: 'database busy',
    })
    handlerMocks.upsert.mockReturnValueOnce(failure).mockReturnValueOnce(failure)
    handlerMocks.listPage.mockReturnValue({
      resources: [],
      total: 0,
      nextCursor: null,
      orderRevision: 'revision-one',
    })
    handlerMocks.pendingOutputs.push(
      pendingCommitOutput(
        SESSION_ONE,
        { commitHash: 'abc123', summary: 'Complete resource hub' },
        { nodeId: 'node-one', branchId: 'branch-one', createdAt: 1_000 },
      ),
    )
    const refetches: Promise<unknown>[] = []
    let invalidationCount = 0
    const unsubscribe = subscribeToSessionResourceInvalidations(({ sessionId }) => {
      if (sessionId !== SESSION_ONE) return
      invalidationCount += 1
      if (invalidationCount <= 2) {
        refetches.push(
          invoke('sessions:resources:page', SESSION_ONE, { view: 'outputs', limit: 6 }),
        )
      }
    })

    try {
      await invoke('sessions:resources:page', SESSION_ONE, { view: 'outputs', limit: 6 })
      expect(handlerMocks.pendingOutputs).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(SESSION_OUTPUT_RETRY_BACKOFF_MS[0])
      await refetches[0]
      expect(handlerMocks.pendingOutputs).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(SESSION_OUTPUT_RETRY_BACKOFF_MS[1])
      await refetches[1]

      expect(handlerMocks.upsert).toHaveBeenCalledTimes(3)
      expect(handlerMocks.pendingOutputs).toEqual([])
      expect(invalidationCount).toBe(3)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      unsubscribe()
    }
  })

  it('locates image adjacency only inside the requested session', async () => {
    const sessionId = SessionId('session-one')
    const location = {
      resource: {
        id: 'image-two',
        sessionId,
        canonicalKey: 'file:/managed/image-two.png',
        kind: 'image' as const,
        title: 'image-two.png',
        mimeType: 'image/png',
        locator: '/managed/image-two.png',
        managed: true,
        available: true,
        isSource: true,
        isOutput: false,
        occurrences: [],
        createdAt: 2,
        updatedAt: 2,
      },
      previous: null,
      next: null,
      index: 1,
      total: 3,
      orderRevision: 'branch-one:node-two:7',
    }
    handlerMocks.locateImage.mockReturnValue(location)

    await expect(
      invoke('sessions:resources:locate-image', sessionId, 'image-two'),
    ).resolves.toEqual(location)
    expect(handlerMocks.locateImage).toHaveBeenCalledWith(sessionId, 'image-two', null)
    await expect(
      invoke('sessions:resources:locate-image', SessionId('session-two'), '../image-two'),
    ).rejects.toBeDefined()
    expect(handlerMocks.locateImage).toHaveBeenCalledOnce()
  })

  it('validates and forwards bounded node-resource pages without widening session ownership', async () => {
    const sessionId = SessionId('session-one')
    const page = { resources: [], total: 0, nextCursor: null, orderRevision: '7' }
    handlerMocks.listByNodeIdsPage.mockReturnValue(page)
    const input = {
      nodeIds: ['node-one', 'node-two'],
      kind: 'image' as const,
      cursor: 'opaque-cursor',
      limit: 64,
    }

    await expect(invoke('sessions:resources:node-page', sessionId, input)).resolves.toEqual(page)
    expect(handlerMocks.listByNodeIdsPage).toHaveBeenCalledWith(sessionId, input)
    await expect(
      invoke('sessions:resources:node-page', sessionId, {
        ...input,
        nodeIds: Array.from({ length: 513 }, (_, index) => `node-${String(index)}`),
      }),
    ).rejects.toBeDefined()
    expect(handlerMocks.listByNodeIdsPage).toHaveBeenCalledOnce()
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
