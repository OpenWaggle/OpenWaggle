import { SessionId } from '@shared/types/brand'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionFollowUpQueueItem } from '@/features/chat/hooks'
import { QueuedMessages } from '../QueuedMessages'

const SESSION = SessionId('session-a')
const onToast = vi.fn()

const queueMock = vi.hoisted(() => {
  const items: SessionFollowUpQueueItem[] = []
  return {
    snapshot: { state: 'running', revision: 0, activeRunId: null, items, waitingOnEdit: false },
    adopt: vi.fn(),
  }
})

vi.mock('@/features/chat/hooks/useSessionFollowUpQueue', () => ({
  useSessionFollowUpQueue: () => ({
    snapshot: queueMock.snapshot,
    error: null,
    refresh: vi.fn(),
    withdraw: vi.fn(),
    setPaused: vi.fn(),
    adopt: queueMock.adopt,
  }),
}))

function queueNeedingAttention(attentionReason: 'profile_revoked' | 'authority_changed') {
  queueMock.snapshot.items = [
    {
      id: 'follow-up-1',
      text: 'run the release checks',
      attachmentCount: 0,
      createdAt: 1,
      deliveryState: 'needs_attention',
      attentionReason,
      attachments: [],
      editable: false,
      source: { callerId: 'profile:profile-ci', profileName: 'ci-bot' },
    },
  ]
}

function renderQueue(isStreaming = false) {
  return render(
    <QueuedMessages
      sessionId={SESSION}
      onSteer={vi.fn()}
      isStreaming={isStreaming}
      onToast={onToast}
    />,
  )
}

function sendAsMe() {
  return screen.getByRole('button', { name: 'Send as me: run the release checks' })
}

describe('QueuedMessages "Send as me"', () => {
  beforeEach(() => {
    onToast.mockClear()
    queueMock.adopt.mockReset().mockResolvedValue(undefined)
  })

  it.each([
    [
      'profile_revoked',
      'The access profile that queued this message was revoked. Send it as you, or dismiss it.',
    ],
    [
      'authority_changed',
      'The access that queued this message no longer covers this Session. Send it as you, or dismiss it.',
    ],
  ] as const)('offers to send a %s message as the user', (reason, copy) => {
    queueNeedingAttention(reason)
    renderQueue()

    expect(screen.getByText(copy)).toBeVisible()
    expect(sendAsMe()).toHaveAccessibleDescription(
      'Deliver this message under your own access. It keeps showing who queued it.',
    )
    fireEvent.click(sendAsMe())
    expect(queueMock.adopt).toHaveBeenCalledWith('follow-up-1')
  })

  it('does not offer it on a message that can be delivered', () => {
    queueNeedingAttention('profile_revoked')
    queueMock.snapshot.items = queueMock.snapshot.items.map((item) => ({
      ...item,
      deliveryState: 'pending' as const,
    }))
    renderQueue()

    expect(screen.queryByRole('button', { name: /^Send as me/ })).not.toBeInTheDocument()
  })

  it('explains that steering waits until the message is sent as the user', () => {
    queueNeedingAttention('authority_changed')
    renderQueue(true)

    const steer = screen.getByRole('button', { name: 'Steer' })
    expect(steer).toBeDisabled()
    expect(steer).toHaveAccessibleDescription('Send this message as you before steering it.')
  })

  it('ignores repeated clicks while the send is in flight', async () => {
    queueNeedingAttention('profile_revoked')
    let finish: (() => void) | undefined
    queueMock.adopt.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    )
    renderQueue()

    fireEvent.click(sendAsMe())
    await waitFor(() => expect(sendAsMe()).toHaveAttribute('aria-disabled', 'true'))
    fireEvent.click(sendAsMe())
    expect(queueMock.adopt).toHaveBeenCalledTimes(1)
    await act(async () => finish?.())
    await waitFor(() => expect(sendAsMe()).toHaveAttribute('aria-disabled', 'false'))
  })

  it('shows a refused send through the toast channel', async () => {
    queueNeedingAttention('profile_revoked')
    queueMock.adopt.mockRejectedValueOnce(new Error('The queue changed. Try again.'))
    renderQueue()

    fireEvent.click(sendAsMe())
    await waitFor(() => expect(onToast).toHaveBeenCalledWith('The queue changed. Try again.'))
  })
})
