import { SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import {
  FirstSendFailed,
  MessageDeliveredRunFailed,
  MessageNotDelivered,
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

  it('says why the Host refused a send, naming its code', () => {
    const refusal = new MessageNotDelivered(
      'refused',
      'host_run_ceiling_reached',
      'host_run_ceiling_reached',
    )
    const notice =
      'Not sent: the Session Host refused it (host_run_ceiling_reached). Your message is back in the composer.'

    expect(disposition({ cause: refusal })).toEqual({ kind: 'restore', notice })
    expect(
      disposition({
        cause: new FirstSendFailed(refusal, createdSessionId),
        activeSessionId: null,
      }),
    ).toEqual({ kind: 'restore', contextKey: 'session:created-session:pending', notice })
  })

  it('prefers the Host’s own words to its code', () => {
    const refusal = new MessageNotDelivered(
      'refused',
      'A steered message is still being delivered to the running agent.',
      'follow_up_reserved',
    )

    expect(disposition({ cause: refusal })).toEqual({
      kind: 'restore',
      notice:
        'Not sent: A steered message is still being delivered to the running agent. Your message is back in the composer.',
    })
  })

  it('says a code-less refusal’s own reason', () => {
    expect(
      disposition({ cause: new MessageNotDelivered('refused', 'Branch source is unavailable.') }),
    ).toEqual({
      kind: 'restore',
      notice: 'Not sent: Branch source is unavailable. Your message is back in the composer.',
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
})
