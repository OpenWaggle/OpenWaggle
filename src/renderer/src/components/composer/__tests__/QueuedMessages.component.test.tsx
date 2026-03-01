import type { ConversationId } from '@shared/types/brand'
import type { QualityPreset } from '@shared/types/settings'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMessageQueueStore } from '@/stores/message-queue-store'
import { QueuedMessages } from '../QueuedMessages'

const CONV_A = 'conv-a' as ConversationId
const QUALITY: QualityPreset = 'medium'

function makePayload(text: string) {
  return { text, qualityPreset: QUALITY, attachments: [] as const }
}

const noOpSteer = vi.fn().mockResolvedValue(undefined)

describe('QueuedMessages', () => {
  beforeEach(() => {
    useMessageQueueStore.setState({ queues: new Map() })
    noOpSteer.mockClear()
  })

  it('renders nothing when the queue is empty', () => {
    const { container } = render(
      <QueuedMessages conversationId={CONV_A} onSteer={noOpSteer} isStreaming={false} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when conversationId is null', () => {
    useMessageQueueStore.getState().enqueue(CONV_A, makePayload('test'))
    const { container } = render(
      <QueuedMessages conversationId={null} onSteer={noOpSteer} isStreaming={false} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders header with count badge', () => {
    useMessageQueueStore.getState().enqueue(CONV_A, makePayload('first'))
    useMessageQueueStore.getState().enqueue(CONV_A, makePayload('second'))
    render(<QueuedMessages conversationId={CONV_A} onSteer={noOpSteer} isStreaming={false} />)
    expect(screen.getByText('Queued')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('renders message cards with text', () => {
    useMessageQueueStore.getState().enqueue(CONV_A, makePayload('first message'))
    useMessageQueueStore.getState().enqueue(CONV_A, makePayload('second message'))
    render(<QueuedMessages conversationId={CONV_A} onSteer={noOpSteer} isStreaming={false} />)
    expect(screen.getByText('first message')).toBeInTheDocument()
    expect(screen.getByText('second message')).toBeInTheDocument()
  })

  it('shows Steer button only when isStreaming is true', () => {
    useMessageQueueStore.getState().enqueue(CONV_A, makePayload('test'))

    const { rerender } = render(
      <QueuedMessages conversationId={CONV_A} onSteer={noOpSteer} isStreaming={false} />,
    )
    expect(screen.queryByText('Steer')).not.toBeInTheDocument()

    rerender(<QueuedMessages conversationId={CONV_A} onSteer={noOpSteer} isStreaming={true} />)
    expect(screen.getByText('Steer')).toBeInTheDocument()
  })

  it('Steer button calls onSteer with correct messageId', () => {
    useMessageQueueStore.getState().enqueue(CONV_A, makePayload('steer me'))
    render(<QueuedMessages conversationId={CONV_A} onSteer={noOpSteer} isStreaming={true} />)

    const steerButton = screen.getByText('Steer')
    fireEvent.click(steerButton)

    expect(noOpSteer).toHaveBeenCalledOnce()
    expect(typeof noOpSteer.mock.calls[0][0]).toBe('string')
  })

  it('Trash button dismisses message', () => {
    useMessageQueueStore.getState().enqueue(CONV_A, makePayload('dismiss me'))
    render(<QueuedMessages conversationId={CONV_A} onSteer={noOpSteer} isStreaming={false} />)
    expect(screen.getByText('dismiss me')).toBeInTheDocument()

    const dismissButton = screen.getByTitle('Dismiss')
    fireEvent.click(dismissButton)

    expect(screen.queryByText('dismiss me')).not.toBeInTheDocument()
  })

  it('shows attachment count for text-less messages', () => {
    useMessageQueueStore.getState().enqueue(CONV_A, {
      text: '',
      qualityPreset: QUALITY,
      attachments: [
        {
          id: 'a1',
          kind: 'text',
          name: 'file.txt',
          path: '/tmp/file.txt',
          mimeType: 'text/plain',
          sizeBytes: 100,
          extractedText: 'content',
        },
      ],
    })
    render(<QueuedMessages conversationId={CONV_A} onSteer={noOpSteer} isStreaming={false} />)
    expect(screen.getByText('1 attachment(s)')).toBeInTheDocument()
  })
})
