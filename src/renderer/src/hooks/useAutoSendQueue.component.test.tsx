import type { ConversationId } from '@shared/types/brand'
import type { QualityPreset } from '@shared/types/settings'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMessageQueueStore } from '@/stores/message-queue-store'
import { useAutoSendQueue } from './useAutoSendQueue'

const CONV_A = 'conv-a' as ConversationId
const QUALITY: QualityPreset = 'medium'

function makePayload(text: string) {
  return { text, qualityPreset: QUALITY, attachments: [] as const }
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
})
