import { SessionId } from '@shared/types/brand'
import type { FollowUpQueuePauseReason } from '@shared/types/session-control-queue'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useQueuedRunStartStore } from '@/features/chat/state'
import { QueuedMessages } from '../QueuedMessages'

const SESSION = SessionId('session-paused-attention')
const onToast = vi.fn()

const api = vi.hoisted(() => ({
  querySessionControl: vi.fn(),
  mutateSessionControl: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api }))

interface QueueRead {
  readonly state: 'running' | 'paused'
  readonly pauseReason?: FollowUpQueuePauseReason
  readonly revision: number
  readonly activeRunId: string | null
  readonly headNeedsAttention: boolean
}

function queueList(read: QueueRead | null) {
  return {
    contractVersion: 2,
    requestId: 'query',
    outcome: {
      operation: 'queue-list',
      sessionId: SESSION,
      queueState: read?.state ?? 'running',
      ...(read?.pauseReason ? { queuePauseReason: read.pauseReason } : {}),
      queueRevision: read?.revision ?? 0,
      activeRunId: read?.activeRunId ?? null,
      items: read
        ? [
            {
              followUpId: 'follow-up-1',
              position: 0,
              createdAt: 1,
              deliveryState: read.headNeedsAttention ? 'needs_attention' : 'pending',
              ...(read.headNeedsAttention ? { attentionReason: 'profile_revoked' } : {}),
              intent: {
                text: 'run the release checks',
                attachmentIds: [],
                callerId: 'profile:ci',
              },
              source: { callerId: 'profile:ci', profileName: 'ci-bot' },
              editable: false,
            },
          ]
        : [],
      omittedBodyCount: 0,
    },
  }
}

/** The queue as the Host left it after the access profile that queued its head was revoked. */
const PAUSED_FOR_ATTENTION: QueueRead = {
  state: 'paused',
  pauseReason: 'profile-revoked',
  revision: 7,
  activeRunId: null,
  headNeedsAttention: true,
}

function adoptResponse(request: { requestId: string; idempotencyKey: string }, effect: object) {
  return {
    contractVersion: 2,
    requestId: request.requestId,
    idempotencyKey: request.idempotencyKey,
    replayed: false,
    outcome: { operation: 'queue-adopt', sessionId: SESSION, ...effect },
  }
}

function renderQueue() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <QueuedMessages sessionId={SESSION} onSteer={vi.fn()} isStreaming={false} onToast={onToast} />
    </QueryClientProvider>,
  )
}

function sendAsMe() {
  return screen.getByRole('button', { name: 'Send as me: run the release checks' })
}

function adoptCalls() {
  return api.mutateSessionControl.mock.calls
    .map(([request]) => request.command)
    .filter((command) => command.operation === 'queue-adopt')
}

describe('"Send as me" from a queue paused for a message that needs attention', () => {
  beforeEach(() => {
    onToast.mockClear()
    useQueuedRunStartStore.setState(useQueuedRunStartStore.getInitialState())
    api.querySessionControl.mockReset().mockResolvedValue(queueList(PAUSED_FOR_ATTENTION))
    api.mutateSessionControl.mockReset()
  })

  it('says it sends now, and the Host resumes the queue and starts the message', async () => {
    api.mutateSessionControl.mockImplementation(async (request) => {
      // The Host resumes the paused queue itself and delivers the adopted head on the idle Session.
      api.querySessionControl.mockResolvedValue(
        queueList({
          state: 'running',
          revision: 9,
          activeRunId: 'run-adopted',
          headNeedsAttention: false,
        }),
      )
      return adoptResponse(request, {
        effect: 'started-run',
        runId: 'run-adopted',
        followUpId: 'follow-up-1',
        queueRevision: 9,
        stateRevision: 3,
      })
    })
    renderQueue()

    expect(
      await screen.findByText(
        'The access profile that queued this message was revoked. Send it as you to send it now, or dismiss it.',
      ),
    ).toBeVisible()
    expect(sendAsMe()).toHaveAccessibleDescription(
      'Send this message now under your own access. It keeps showing who queued it.',
    )
    fireEvent.click(sendAsMe())

    await waitFor(() =>
      expect(adoptCalls()).toEqual([
        {
          operation: 'queue-adopt',
          sessionId: SESSION,
          followUpId: 'follow-up-1',
          expectedQueueRevision: 7,
        },
      ]),
    )
    // No separate Resume: the queue left the paused state with the adoption.
    expect(
      api.mutateSessionControl.mock.calls.some(
        ([request]) => request.command.operation === 'queue-resume',
      ),
    ).toBe(false)
    // The Session counts as starting that Run until it reports in, so its settings stay locked.
    expect(useQueuedRunStartStore.getState().runIdBySessionId.get(SESSION)).toBe('run-adopted')
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^Send as me/ })).not.toBeInTheDocument(),
    )
    expect(onToast).not.toHaveBeenCalled()
  })

  it('retries once against the re-read queue when another change landed first', async () => {
    api.mutateSessionControl
      .mockImplementationOnce(async (request) => {
        api.querySessionControl.mockResolvedValue(
          queueList({ ...PAUSED_FOR_ATTENTION, revision: 8 }),
        )
        return adoptResponse(request, { effect: 'rejected', code: 'queue_revision_changed' })
      })
      .mockImplementationOnce(async (request) =>
        adoptResponse(request, {
          effect: 'queue-updated',
          queueState: 'running',
          queueRevision: 9,
          followUpIds: ['follow-up-1'],
          stateRevision: 4,
        }),
      )
    renderQueue()

    fireEvent.click(await screen.findByRole('button', { name: /^Send as me/ }))

    await waitFor(() => expect(adoptCalls()).toHaveLength(2))
    expect(adoptCalls().map((command) => command.expectedQueueRevision)).toEqual([7, 8])
    expect(onToast).not.toHaveBeenCalled()
  })

  it('stops without a retry when someone already sent it', async () => {
    api.mutateSessionControl.mockImplementationOnce(async (request) => {
      api.querySessionControl.mockResolvedValue(
        queueList({
          state: 'running',
          revision: 8,
          activeRunId: 'run-other',
          headNeedsAttention: false,
        }),
      )
      return adoptResponse(request, { effect: 'rejected', code: 'queue_revision_changed' })
    })
    renderQueue()

    fireEvent.click(await screen.findByRole('button', { name: /^Send as me/ }))

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^Send as me/ })).not.toBeInTheDocument(),
    )
    expect(adoptCalls()).toHaveLength(1)
    expect(onToast).not.toHaveBeenCalled()
  })

  it('tells the user in words when the message left the queue', async () => {
    api.mutateSessionControl.mockImplementationOnce(async (request) => {
      api.querySessionControl.mockResolvedValue(queueList(null))
      return adoptResponse(request, { effect: 'rejected', code: 'queue_revision_changed' })
    })
    renderQueue()

    fireEvent.click(await screen.findByRole('button', { name: /^Send as me/ }))

    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith('This message is no longer in the queue.'),
    )
    expect(adoptCalls()).toHaveLength(1)
  })
})
