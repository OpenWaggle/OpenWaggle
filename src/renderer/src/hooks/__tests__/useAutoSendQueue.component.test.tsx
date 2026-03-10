import type { ConversationId } from '@shared/types/brand'
import type { QualityPreset } from '@shared/types/settings'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMessageQueueStore } from '@/stores/message-queue-store'
import { useAutoSendQueue } from '../useAutoSendQueue'

const CONV_A = 'conv-a' as ConversationId
const CONV_B = 'conv-b' as ConversationId
const QUALITY: QualityPreset = 'medium'

function makePayload(text: string) {
  return { text, qualityPreset: QUALITY, attachments: [] as const }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useAutoSendQueue', () => {
  beforeEach(() => {
    useMessageQueueStore.setState({ queues: new Map() })
  })

  it('does NOT fire on initial mount when status is already ready', () => {
    const send = vi.fn().mockResolvedValue(undefined)
    useMessageQueueStore.getState().enqueue(CONV_A, makePayload('test'))

    renderHook(() =>
      useAutoSendQueue({ conversationId: CONV_A, status: 'ready', sendMessage: send }),
    )

    expect(send).not.toHaveBeenCalled()
  })

  it('fires when status transitions from streaming to ready', () => {
    const send = vi.fn().mockResolvedValue(undefined)
    useMessageQueueStore.getState().enqueue(CONV_A, makePayload('queued'))

    const { rerender } = renderHook(
      ({ status }: { status: 'ready' | 'streaming' }) =>
        useAutoSendQueue({ conversationId: CONV_A, status, sendMessage: send }),
      { initialProps: { status: 'streaming' as const } },
    )

    rerender({ status: 'ready' })

    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0][0].text).toBe('queued')
  })

  it('does NOT fire when queue is empty', () => {
    const send = vi.fn().mockResolvedValue(undefined)

    const { rerender } = renderHook(
      ({ status }: { status: 'ready' | 'streaming' }) =>
        useAutoSendQueue({ conversationId: CONV_A, status, sendMessage: send }),
      { initialProps: { status: 'streaming' as const } },
    )

    rerender({ status: 'ready' })

    expect(send).not.toHaveBeenCalled()
  })

  it('does NOT fire when conversationId is null', () => {
    const send = vi.fn().mockResolvedValue(undefined)
    useMessageQueueStore.getState().enqueue(CONV_A, makePayload('test'))

    const { rerender } = renderHook(
      ({ status }: { status: 'ready' | 'streaming' }) =>
        useAutoSendQueue({ conversationId: null, status, sendMessage: send }),
      { initialProps: { status: 'streaming' as const } },
    )

    rerender({ status: 'ready' })

    expect(send).not.toHaveBeenCalled()
  })

  it('does NOT fire when paused even on valid transition', () => {
    const send = vi.fn().mockResolvedValue(undefined)
    useMessageQueueStore.getState().enqueue(CONV_A, makePayload('test'))

    const { rerender } = renderHook(
      ({ status, paused }: { status: 'ready' | 'streaming'; paused: boolean }) =>
        useAutoSendQueue({ conversationId: CONV_A, status, sendMessage: send, paused }),
      { initialProps: { status: 'streaming' as const, paused: true } },
    )

    rerender({ status: 'ready', paused: true })

    expect(send).not.toHaveBeenCalled()
  })

  it('fires when unpaused after a paused transition', () => {
    const send = vi.fn().mockResolvedValue(undefined)
    useMessageQueueStore.getState().enqueue(CONV_A, makePayload('delayed'))

    const { rerender } = renderHook(
      ({ status, paused }: { status: 'ready' | 'submitted' | 'streaming'; paused: boolean }) =>
        useAutoSendQueue({ conversationId: CONV_A, status, sendMessage: send, paused }),
      { initialProps: { status: 'streaming' as const, paused: false } },
    )

    // Steer transition: status goes ready but paused
    rerender({ status: 'ready', paused: true })
    expect(send).not.toHaveBeenCalled()

    // Steered message streams
    rerender({ status: 'submitted', paused: true })
    rerender({ status: 'streaming', paused: true })

    // Stream done + unpause
    rerender({ status: 'ready', paused: false })
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0][0].text).toBe('delayed')
  })

  it('preserves prevStatus across paused renders', () => {
    const send = vi.fn().mockResolvedValue(undefined)
    useMessageQueueStore.getState().enqueue(CONV_A, makePayload('preserved'))

    const { rerender } = renderHook(
      ({ status, paused }: { status: 'ready' | 'submitted' | 'streaming'; paused: boolean }) =>
        useAutoSendQueue({ conversationId: CONV_A, status, sendMessage: send, paused }),
      { initialProps: { status: 'streaming' as const, paused: false } },
    )

    // Pause during streaming
    rerender({ status: 'ready', paused: true })
    // Multiple paused renders with different statuses
    rerender({ status: 'submitted', paused: true })
    rerender({ status: 'streaming', paused: true })
    rerender({ status: 'ready', paused: true })

    expect(send).not.toHaveBeenCalled()

    // Unpause — prevStatus should still be 'streaming' (the last non-paused value)
    rerender({ status: 'ready', paused: false })
    expect(send).toHaveBeenCalledOnce()
  })

  it('does not auto-send newly queued messages while the agent is still streaming', () => {
    const send = vi.fn().mockResolvedValue(undefined)

    renderHook(() =>
      useAutoSendQueue({ conversationId: CONV_A, status: 'streaming', sendMessage: send }),
    )

    useMessageQueueStore.getState().enqueue(CONV_A, makePayload('wait until ready'))

    expect(send).not.toHaveBeenCalled()
    const queue = useMessageQueueStore.getState().queues.get(CONV_A) ?? []
    expect(queue).toHaveLength(1)
    expect(queue[0]?.payload.text).toBe('wait until ready')
  })

  it('re-enqueues and reports send failures', async () => {
    const sendError = new Error('send failed')
    const send = vi.fn().mockRejectedValue(sendError)
    const onSendFailure = vi.fn()
    useMessageQueueStore.getState().enqueue(CONV_A, makePayload('retry me'))

    const { rerender } = renderHook(
      ({ status }: { status: 'ready' | 'streaming' }) =>
        useAutoSendQueue({
          conversationId: CONV_A,
          status,
          sendMessage: send,
          onSendFailure,
        }),
      { initialProps: { status: 'streaming' as const } },
    )

    rerender({ status: 'ready' })

    await waitFor(() => {
      expect(onSendFailure).toHaveBeenCalledTimes(1)
    })

    const queue = useMessageQueueStore.getState().queues.get(CONV_A) ?? []
    expect(queue).toHaveLength(1)
    expect(queue[0]?.payload.text).toBe('retry me')

    const firstCall = onSendFailure.mock.calls[0]
    expect(firstCall?.[0]).toEqual(makePayload('retry me'))
    expect(firstCall?.[1]).toBe(sendError)
  })

  it('reports send failure through the callback captured for the original conversation', async () => {
    const sendDeferred = createDeferred<void>()
    const send = vi.fn().mockReturnValue(sendDeferred.promise)
    const onSendFailureA = vi.fn()
    const onSendFailureB = vi.fn()
    useMessageQueueStore.getState().enqueue(CONV_A, makePayload('switch-safe retry'))

    const { rerender } = renderHook(
      ({
        conversationId,
        status,
        onSendFailure,
      }: {
        conversationId: ConversationId | null
        status: 'ready' | 'streaming'
        onSendFailure?: (payload: ReturnType<typeof makePayload>, error: unknown) => void
      }) =>
        useAutoSendQueue({
          conversationId,
          status,
          sendMessage: send,
          onSendFailure,
        }),
      {
        initialProps: {
          conversationId: CONV_A,
          status: 'streaming' as const,
          onSendFailure: onSendFailureA,
        },
      },
    )

    rerender({
      conversationId: CONV_A,
      status: 'ready',
      onSendFailure: onSendFailureA,
    })

    rerender({
      conversationId: CONV_B,
      status: 'ready',
      onSendFailure: onSendFailureB,
    })

    const sendError = new Error('late failure')
    sendDeferred.reject(sendError)

    await waitFor(() => {
      expect(onSendFailureA).toHaveBeenCalledTimes(1)
    })

    expect(onSendFailureB).not.toHaveBeenCalled()
    expect(onSendFailureA).toHaveBeenCalledWith(makePayload('switch-safe retry'), sendError)
  })
})
