import type { FollowUpQueuePauseReason } from '@shared/types/session-control-queue'
import { describe, expect, it } from 'vitest'
import type { SessionFollowUpQueueItem } from '@/features/chat/hooks'
import { sendAsMeStartsNow } from '../send-as-me'

function item(id: string, deliveryState: SessionFollowUpQueueItem['deliveryState']) {
  const result: SessionFollowUpQueueItem = {
    id,
    text: id,
    attachmentCount: 0,
    createdAt: 1,
    deliveryState,
    attachments: [],
    editable: false,
  }
  return result
}

function startsNow(input: {
  readonly state: 'running' | 'paused'
  readonly pauseReason?: FollowUpQueuePauseReason
  readonly activeRunId?: string | null
  readonly items?: readonly SessionFollowUpQueueItem[]
  readonly followUpId?: string
  readonly isStreaming?: boolean
}) {
  return sendAsMeStartsNow({
    queue: {
      state: input.state,
      ...(input.pauseReason ? { pauseReason: input.pauseReason } : {}),
      activeRunId: input.activeRunId ?? null,
      items: input.items ?? [item('a', 'needs_attention')],
    },
    followUpId: input.followUpId ?? 'a',
    isStreaming: input.isStreaming ?? false,
  })
}

describe('sendAsMeStartsNow mirrors the Host adoption rule', () => {
  it('starts the head of a running queue on an idle Session', () => {
    expect(startsNow({ state: 'running' })).toBe(true)
  })

  it('waits when the head is held for an edit, which the Host never delivers', () => {
    const held: SessionFollowUpQueueItem = {
      ...item('a', 'needs_attention'),
      editHold: { heldByCurrentUser: true, acquiredAt: 1, leaseExpiresAt: 2 },
    }
    expect(startsNow({ state: 'running', items: [held] })).toBe(false)
  })

  it.each([undefined, 'profile-revoked'] as const)(
    'resumes a queue attention paused (%s) when this is the only message needing attention',
    (pauseReason) => {
      expect(
        startsNow({
          state: 'paused',
          ...(pauseReason ? { pauseReason } : {}),
          items: [item('a', 'needs_attention'), item('b', 'pending')],
        }),
      ).toBe(true)
    },
  )

  it.each(['requested', 'run-failed', 'run-interrupted', 'host-lost'] as const)(
    'keeps a queue paused for %s waiting',
    (pauseReason) => {
      expect(startsNow({ state: 'paused', pauseReason })).toBe(false)
    },
  )

  it('keeps an attention pause while another message still needs attention', () => {
    expect(
      startsNow({
        state: 'paused',
        items: [item('a', 'needs_attention'), item('b', 'needs_attention')],
      }),
    ).toBe(false)
  })

  it('waits while the Session has a Run, reported by the Host or streaming here', () => {
    expect(startsNow({ state: 'running', activeRunId: 'run-1' })).toBe(false)
    expect(startsNow({ state: 'running', isStreaming: true })).toBe(false)
  })

  it('waits its turn behind an earlier message', () => {
    expect(
      startsNow({
        state: 'running',
        items: [item('first', 'pending'), item('a', 'needs_attention')],
      }),
    ).toBe(false)
  })

  // Agents' Follow-ups wait for a slot; the adopted message is the person's and starts ahead.
  describe('in a queue waiting on agents’ capacity', () => {
    const agents = item('agents', 'pending')
    const mine = { ...item('mine', 'pending'), editable: true }

    it('starts the adopted message behind agents’ ones', () => {
      expect(
        startsNow({
          state: 'paused',
          pauseReason: 'parent-limit',
          items: [agents, item('a', 'needs_attention')],
        }),
      ).toBe(true)
    })

    it('waits behind this user’s own earlier message, which starts first', () => {
      expect(
        startsNow({
          state: 'paused',
          pauseReason: 'parent-limit',
          items: [mine, item('a', 'needs_attention')],
        }),
      ).toBe(false)
    })

    it('waits behind this user’s CLI message, which the Host also starts first', () => {
      const cli = { ...item('cli', 'pending'), callerId: 'local-user:cli' }
      expect(
        startsNow({
          state: 'paused',
          pauseReason: 'parent-limit',
          items: [cli, item('a', 'needs_attention')],
        }),
      ).toBe(false)
    })

    it('waits behind an edit up to it', () => {
      const held = {
        ...agents,
        editHold: { heldByCurrentUser: false, acquiredAt: 1, leaseExpiresAt: 2 },
      }
      expect(
        startsNow({
          state: 'paused',
          pauseReason: 'parent-limit',
          items: [held, item('a', 'needs_attention')],
        }),
      ).toBe(false)
    })
  })
})
