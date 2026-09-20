import { SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import {
  FirstSendFailed,
  MessageDeliveredRunFailed,
  MessageNotDelivered,
} from '../message-delivery'
import { sessionImageSendFailureDisposition } from '../session-image-send-failure'

const sessionId = SessionId('existing-session')
const createdSessionId = SessionId('created-session')

function disposition(input: {
  readonly cause: unknown
  readonly activeSessionId?: typeof sessionId | null
  readonly disposedSessions?: ReadonlySet<typeof sessionId>
  readonly hasWorktreeLaunch?: boolean
  readonly activeDraftContextKey?: string | null
  readonly savedDraftContextKeys?: readonly string[]
}) {
  return sessionImageSendFailureDisposition({
    cause: input.cause,
    activeSessionId: input.activeSessionId ?? sessionId,
    activeDraftContextKey: input.activeDraftContextKey ?? null,
    savedDraftContextKeys: input.savedDraftContextKeys ?? [],
    disposedSessions: input.disposedSessions ?? new Set(),
    hasWorktreeLaunch: () => input.hasWorktreeLaunch ?? false,
  })
}

describe('Session image send failure ownership', () => {
  it('restores an undelivered existing-session draft unless deletion committed', () => {
    const cause = new MessageNotDelivered('refused')
    expect(disposition({ cause })).toEqual({ kind: 'restore' })
    expect(disposition({ cause, disposedSessions: new Set([sessionId]) })).toEqual({
      kind: 'discard',
    })
  })

  it('restores a pre-delivery IPC or session-creation failure', () => {
    expect(disposition({ cause: new Error('IPC failed') })).toEqual({ kind: 'restore' })
    expect(disposition({ cause: new Error('Create failed'), activeSessionId: null })).toEqual({
      kind: 'restore',
    })
  })

  it('restores a refused local first send to the created Session draft', () => {
    const cause = new FirstSendFailed(new MessageNotDelivered('refused'), createdSessionId)
    expect(disposition({ cause, activeSessionId: null })).toEqual({
      kind: 'restore',
      contextKey: 'session:created-session:pending',
    })
  })

  it('restores to the created Session context when it is already active', () => {
    const cause = new FirstSendFailed(new MessageNotDelivered('refused'), createdSessionId)
    expect(
      disposition({
        cause,
        activeSessionId: null,
        activeDraftContextKey: 'session:created-session:pending',
      }),
    ).toEqual({ kind: 'restore', contextKey: 'session:created-session:pending' })
  })

  it('merges into a saved created-Session draft after switching away', () => {
    const cause = new FirstSendFailed(new MessageNotDelivered('refused'), createdSessionId)
    expect(
      disposition({
        cause,
        activeSessionId: null,
        activeDraftContextKey: 'session:other-session:pending',
        savedDraftContextKeys: ['project:/repo:session:created-session:main'],
      }),
    ).toEqual({ kind: 'restore', contextKey: 'project:/repo:session:created-session:main' })
  })

  it('leaves worktree first-send recovery alone and discards deleted Sessions', () => {
    const cause = new FirstSendFailed(new MessageNotDelivered('refused'), createdSessionId)
    expect(disposition({ cause, activeSessionId: null, hasWorktreeLaunch: true })).toEqual({
      kind: 'retain',
    })
    expect(
      disposition({ cause, activeSessionId: null, disposedSessions: new Set([createdSessionId]) }),
    ).toEqual({ kind: 'discard' })
  })

  it('does not restore a message that reached the agent', () => {
    expect(
      disposition({ cause: new MessageDeliveredRunFailed(new Error('Provider failed')) }),
    ).toEqual({ kind: 'retain' })
    expect(
      disposition({
        cause: new FirstSendFailed(
          new MessageDeliveredRunFailed(new Error('Provider failed')),
          createdSessionId,
        ),
        activeSessionId: null,
      }),
    ).toEqual({ kind: 'retain' })
  })
})
