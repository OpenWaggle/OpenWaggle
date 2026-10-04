import { SessionId } from '@shared/types/brand'
import type { FollowUpQueuePauseReason } from '@shared/types/session-control-queue'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionControlRejectedError, type SessionFollowUpQueueItem } from '@/features/chat/hooks'
import { QueuedMessages } from '../QueuedMessages'

const SESSION = SessionId('session-a')
const onToast = vi.fn()

const queueMock = vi.hoisted(() => {
  const items: SessionFollowUpQueueItem[] = []
  const snapshot: {
    state: 'running' | 'paused'
    pauseReason: FollowUpQueuePauseReason | undefined
    revision: number
    activeRunId: string | null
    items: SessionFollowUpQueueItem[]
    waitingOnEdit: boolean
  } = {
    state: 'running',
    pauseReason: undefined,
    revision: 0,
    activeRunId: null,
    items,
    waitingOnEdit: false,
  }
  return {
    snapshot,
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
    queueMock.snapshot.state = 'running'
    queueMock.snapshot.pauseReason = undefined
    queueMock.snapshot.activeRunId = null
    queueMock.adopt.mockReset().mockResolvedValue(undefined)
  })

  it.each([
    [
      'profile_revoked',
      'The access profile that queued this message was revoked. Send it as you to send it now, or dismiss it.',
    ],
    [
      'authority_changed',
      'The access that queued this message no longer covers this Session. Send it as you to send it now, or dismiss it.',
    ],
  ] as const)('offers to send a %s message as the user, now', (reason, copy) => {
    queueNeedingAttention(reason)
    renderQueue()

    expect(screen.getByText(copy)).toBeVisible()
    expect(sendAsMe()).toHaveAccessibleDescription(
      'Send this message now under your own access. It keeps showing who queued it.',
    )
    fireEvent.click(sendAsMe())
    expect(queueMock.adopt).toHaveBeenCalledWith('follow-up-1', 0)
  })

  it('says it sends in turn while a Run is going', () => {
    queueNeedingAttention('profile_revoked')
    renderQueue(true)

    expect(
      screen.getByText(
        'The access profile that queued this message was revoked. Send it as you to send it in its turn, or dismiss it.',
      ),
    ).toBeVisible()
    expect(sendAsMe()).toHaveAccessibleDescription(
      'Send this message in its turn under your own access. It keeps showing who queued it.',
    )
  })

  it('says it sends in turn when the queue paused for another reason', () => {
    queueNeedingAttention('authority_changed')
    queueMock.snapshot.state = 'paused'
    queueMock.snapshot.pauseReason = 'requested'
    renderQueue()

    expect(sendAsMe()).toHaveAccessibleDescription(
      'Send this message in its turn under your own access. It keeps showing who queued it.',
    )
  })

  const SENDS_NOW = 'Send this message now under your own access. It keeps showing who queued it.'
  const SENDS_IN_TURN =
    'Send this message in its turn under your own access. It keeps showing who queued it.'

  it.each([undefined, 'profile-revoked'] as const)(
    'says it sends now when attention paused the queue (%s) and this is the last message needing it',
    (pauseReason) => {
      queueNeedingAttention('authority_changed')
      queueMock.snapshot.state = 'paused'
      queueMock.snapshot.pauseReason = pauseReason
      renderQueue()

      expect(sendAsMe()).toHaveAccessibleDescription(SENDS_NOW)
    },
  )

  it('says it sends in turn when another message still needs attention', () => {
    queueNeedingAttention('profile_revoked')
    const [head] = queueMock.snapshot.items
    if (!head) throw new Error('expected a queued message')
    queueMock.snapshot.items = [head, { ...head, id: 'follow-up-2', text: 'and publish' }]
    queueMock.snapshot.state = 'paused'
    queueMock.snapshot.pauseReason = 'profile-revoked'
    renderQueue()

    // Adopting the first leaves the second needing attention, so the Host keeps the queue paused.
    expect(sendAsMe()).toHaveAccessibleDescription(SENDS_IN_TURN)
  })

  it('says it sends in turn while the Host reports a Run this window is not streaming', () => {
    queueNeedingAttention('profile_revoked')
    queueMock.snapshot.activeRunId = 'run-from-cli'
    renderQueue()

    expect(sendAsMe()).toHaveAccessibleDescription(SENDS_IN_TURN)
  })

  it('says it sends in turn for a message that is not first in the queue', () => {
    queueNeedingAttention('profile_revoked')
    const [needsAttention] = queueMock.snapshot.items
    if (!needsAttention) throw new Error('expected a queued message')
    queueMock.snapshot.items = [
      { ...needsAttention, id: 'follow-up-0', text: 'first', deliveryState: 'pending' },
      needsAttention,
    ]
    renderQueue()

    expect(sendAsMe()).toHaveAccessibleDescription(SENDS_IN_TURN)
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

  it('shows a refused send through the toast channel in words, not the Host code', async () => {
    queueNeedingAttention('profile_revoked')
    queueMock.adopt.mockRejectedValueOnce(
      new SessionControlRejectedError('queue-adopt', 'follow_up_not_found'),
    )
    renderQueue()

    fireEvent.click(sendAsMe())
    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith('This message is no longer in the queue.'),
    )
    expect(onToast).not.toHaveBeenCalledWith(expect.stringContaining('Session Control'))
  })
})
