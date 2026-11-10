import { SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import {
  FirstSendFailed,
  MessageDeliveredRunFailed,
  MessageNotDelivered,
  SendFailedBehindLaterSend,
} from '../message-delivery'
import {
  PI_SESSION_FILE_REFUSAL_NOTICE,
  refusedSendNotice,
  sessionImageSendFailureDisposition,
} from '../session-image-send-failure'

const REFUSED_NOTICE = refusedSendNotice(new MessageNotDelivered('refused'))

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
    expect(disposition({ cause })).toEqual({ kind: 'restore', notice: REFUSED_NOTICE })
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
      notice: REFUSED_NOTICE,
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
    ).toEqual({
      kind: 'restore',
      contextKey: 'session:created-session:pending',
      notice: REFUSED_NOTICE,
    })
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
    ).toEqual({
      kind: 'restore',
      contextKey: 'project:/repo:session:created-session:main',
      notice: REFUSED_NOTICE,
    })
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

  it('restores a send refused for an unusable Pi file, with a toast instead of an error', () => {
    const cause = new MessageNotDelivered(
      'refused',
      "This Session's Pi session file is unavailable (/p/s.jsonl): its folder is missing.",
    )

    expect(disposition({ cause })).toEqual({
      kind: 'restore',
      notice: PI_SESSION_FILE_REFUSAL_NOTICE,
    })
  })

  it('says in plain words why the Host refused a send, naming its code', () => {
    const refusal = new MessageNotDelivered(
      'refused',
      'queue_capacity_reached',
      'queue_capacity_reached',
    )
    const notice =
      'Not sent: this Session already has as many queued messages as it can hold (queue_capacity_reached). Your message is back in the composer.'

    expect(disposition({ cause: refusal })).toEqual({ kind: 'restore', notice })
    expect(
      disposition({
        cause: new FirstSendFailed(refusal, createdSessionId),
        activeSessionId: null,
      }),
    ).toEqual({ kind: 'restore', contextKey: 'session:created-session:pending', notice })
  })

  it('names the code of a refusal it has no words for', () => {
    const refusal = new MessageNotDelivered('refused', 'session_archived', 'session_archived')

    expect(disposition({ cause: refusal })).toEqual({
      kind: 'restore',
      notice:
        'Not sent: the Session Host refused it (session_archived). Your message is back in the composer.',
    })
  })

  it('puts the Host’s own words first when it wrote some, keeping the code', () => {
    const refusal = new MessageNotDelivered(
      'refused',
      'A steered message is still being delivered to the running agent.',
      'follow_up_reserved',
    )

    expect(disposition({ cause: refusal })).toEqual({
      kind: 'restore',
      notice:
        'Not sent: a steered message is still being delivered to the running agent (follow_up_reserved). Your message is back in the composer.',
    })
  })

  it('says a code-less refusal’s own reason', () => {
    expect(
      disposition({ cause: new MessageNotDelivered('refused', 'Branch source is unavailable.') }),
    ).toEqual({
      kind: 'restore',
      notice: 'Not sent: branch source is unavailable. Your message is back in the composer.',
    })
    expect(REFUSED_NOTICE).toBe('Not sent. Your message is back in the composer.')
  })

  it('restores a failure that was not a refusal without a notice', () => {
    expect(disposition({ cause: new MessageNotDelivered('cancelled') })).toEqual({
      kind: 'restore',
    })
    expect(
      disposition({
        cause: new FirstSendFailed(new Error('Create failed'), createdSessionId),
        activeSessionId: null,
      }),
    ).toEqual({ kind: 'restore', contextKey: 'session:created-session:pending' })
  })

  // No error of the Session's shows it, so a toast does, without Electron's transport prefix,
  // and it is logged as the failure it is.
  it('says why a send failed behind a later one, as an unexpected failure', () => {
    const failure = new SendFailedBehindLaterSend(
      new Error("Error invoking remote method 'agent:send-message': Error: handler died"),
    )
    const notice = 'Could not send: handler died. Your message is back in the composer.'

    expect(disposition({ cause: failure })).toEqual({ kind: 'restore', notice, unexpected: true })
    expect(
      disposition({ cause: new FirstSendFailed(failure, createdSessionId), activeSessionId: null }),
    ).toEqual({
      kind: 'restore',
      contextKey: 'session:created-session:pending',
      notice,
      unexpected: true,
    })
  })
})
