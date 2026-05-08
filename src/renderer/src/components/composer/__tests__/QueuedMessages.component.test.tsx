import { SessionId } from '@shared/types/brand'
import type { ThinkingLevel } from '@shared/types/settings'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMessageQueueStore } from '../../../stores/message-queue-store'
import { QueuedMessages } from '../QueuedMessages'

const CONV_A = SessionId('session-a')
const THINKING: ThinkingLevel = 'medium'

function makePayload(text: string) {
  return { text, thinkingLevel: THINKING, attachments: [] as const }
}

const noOpSteer = vi.fn().mockResolvedValue(undefined)

describe('QueuedMessages', () => {
  beforeEach(() => {
    useMessageQueueStore.setState({ queues: new Map() })
    noOpSteer.mockClear()
  })

  it('renders nothing when the queue is empty', () => {
    const { container } = render(
      <QueuedMessages sessionId={CONV_A} onSteer={noOpSteer} isStreaming={false} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when sessionId is null', () => {
    useMessageQueueStore.getState().enqueue(CONV_A, makePayload('test'))
    const { container } = render(
      <QueuedMessages sessionId={null} onSteer={noOpSteer} isStreaming={false} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders header with count badge', () => {
    useMessageQueueStore.getState().enqueue(CONV_A, makePayload('first'))
    useMessageQueueStore.getState().enqueue(CONV_A, makePayload('second'))
    render(<QueuedMessages sessionId={CONV_A} onSteer={noOpSteer} isStreaming={false} />)
    expect(screen.getByText('Queued')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('renders message cards with text', () => {
    useMessageQueueStore.getState().enqueue(CONV_A, makePayload('first message'))
    useMessageQueueStore.getState().enqueue(CONV_A, makePayload('second message'))
    render(<QueuedMessages sessionId={CONV_A} onSteer={noOpSteer} isStreaming={false} />)
    expect(screen.getByText('first message')).toBeInTheDocument()
    expect(screen.getByText('second message')).toBeInTheDocument()
  })

  it('shows Steer button only when isStreaming is true', () => {
    useMessageQueueStore.getState().enqueue(CONV_A, makePayload('test'))

    const { rerender } = render(
      <QueuedMessages sessionId={CONV_A} onSteer={noOpSteer} isStreaming={false} />,
    )
    expect(screen.queryByText('Steer')).not.toBeInTheDocument()

    rerender(<QueuedMessages sessionId={CONV_A} onSteer={noOpSteer} isStreaming={true} />)
    expect(screen.getByText('Steer')).toBeInTheDocument()
  })

  it('uses compaction copy and hides Steer while compaction is running', () => {
    useMessageQueueStore.getState().enqueue(CONV_A, makePayload('wait for compact'))

    render(
      <QueuedMessages
        sessionId={CONV_A}
        onSteer={noOpSteer}
        isStreaming={true}
        isCompacting={true}
      />,
    )

    expect(screen.getByText('Queued until compaction finishes')).toBeInTheDocument()
    expect(screen.queryByText('Steer')).not.toBeInTheDocument()
  })

  it('Steer button calls onSteer with correct messageId', () => {
    useMessageQueueStore.getState().enqueue(CONV_A, makePayload('steer me'))
    render(<QueuedMessages sessionId={CONV_A} onSteer={noOpSteer} isStreaming={true} />)

    const steerButton = screen.getByText('Steer')
    fireEvent.click(steerButton)

    expect(noOpSteer).toHaveBeenCalledOnce()
    expect(typeof noOpSteer.mock.calls[0][0]).toBe('string')
  })

  it('Trash button dismisses message', () => {
    useMessageQueueStore.getState().enqueue(CONV_A, makePayload('dismiss me'))
    render(<QueuedMessages sessionId={CONV_A} onSteer={noOpSteer} isStreaming={false} />)
    expect(screen.getByText('dismiss me')).toBeInTheDocument()

    const dismissButton = screen.getByTitle('Dismiss')
    fireEvent.click(dismissButton)

    expect(screen.queryByText('dismiss me')).not.toBeInTheDocument()
  })

  it('shows attachment count for text-less messages', () => {
    useMessageQueueStore.getState().enqueue(CONV_A, {
      text: '',
      thinkingLevel: THINKING,
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
    render(<QueuedMessages sessionId={CONV_A} onSteer={noOpSteer} isStreaming={false} />)
    expect(screen.getByText('1 attachment(s)')).toBeInTheDocument()
  })
})
