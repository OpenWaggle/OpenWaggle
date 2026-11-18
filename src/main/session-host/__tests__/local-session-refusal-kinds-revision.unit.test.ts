import { decodeSessionControlMutationOutcome } from '@shared/schemas/session-control'
import {
  LOCAL_SESSION_REVISION_31_CAPABILITIES,
  LOCAL_SESSION_REVISION_32_CAPABILITIES,
} from '@shared/types/local-session-protocol-revisions'
import { fromPartial } from '@total-typescript/shoehorn'
import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { SessionHostLiveness } from '../../application/session-host-liveness'
import { LocalSessionCommandAuthorizationError } from '../../errors'
import { localSessionClientProtocolError } from '../local-session-client-protocol-error'
import { executeLocalSessionCommandFrame } from '../local-session-command-frame'
import type { LocalSessionServerDependencies } from '../local-session-server'

/** The error frame the Session Host sends when its dispatch fails with `failure`. */
async function errorFrameFor(failure: () => Promise<unknown>) {
  const liveness = new SessionHostLiveness({ idleGracePeriodMs: 60_000, requestShutdown: vi.fn() })
  const send = vi.fn(async (_frame: unknown) => undefined)
  await executeLocalSessionCommandFrame({
    frame: {
      kind: 'command',
      requestId: 'request-1',
      payload: { contract: 'session-query-v2', request: {} },
    },
    caller: fromPartial({ callerId: 'profile:reviewer' }),
    negotiatedRevision: 32,
    dependencies: fromPartial<LocalSessionServerDependencies>({
      hostInstanceId: 'host-1',
      liveness,
      dispatch: failure,
    }),
    eventCursor: { hostInstanceId: 'host-1', sequence: 0 },
    resolveEventCursor: () => fromPartial({}),
    exposeEventCursor: (cursor) => cursor,
    signal: new AbortController().signal,
    send,
  })
  return send.mock.calls[0]?.[0]
}

describe('Local Session refusal kinds (revision 32, ADR 0063)', () => {
  it('advertises refusal kinds from revision 32', () => {
    expect(LOCAL_SESSION_REVISION_31_CAPABILITIES).not.toContain('sessions:refusal-kinds-v1')
    expect(LOCAL_SESSION_REVISION_32_CAPABILITIES).toContain('sessions:refusal-kinds-v1')
  })

  it('decodes a rejected outcome only with its kind', () => {
    const rejected = {
      operation: 'steer',
      effect: 'rejected',
      sessionId: 'session-1',
      code: 'run_changed',
    }

    expect(() => decodeSessionControlMutationOutcome(rejected)).toThrow()
    expect(decodeSessionControlMutationOutcome({ ...rejected, kind: 'conflict' })).toEqual({
      ...rejected,
      kind: 'conflict',
    })
    expect(() => decodeSessionControlMutationOutcome({ ...rejected, kind: 'stale' })).toThrow()
  })

  it('names the kind of a thrown refusal from the table alone', async () => {
    await expect(
      errorFrameFor(() =>
        Effect.runPromise(
          Effect.fail(new LocalSessionCommandAuthorizationError({ code: 'target_scope_denied' })),
        ),
      ),
    ).resolves.toMatchObject({ code: 'target_scope_denied', errorKind: 'authorization' })
    // The caller's own profile deleted mid-connection is a credential problem (target_profile_not_found
    // names a missing target).
    await expect(
      errorFrameFor(() =>
        Effect.runPromise(
          Effect.fail(new LocalSessionCommandAuthorizationError({ code: 'profile_not_found' })),
        ),
      ),
    ).resolves.toMatchObject({ code: 'profile_not_found', errorKind: 'authentication' })
    await expect(
      errorFrameFor(async () => {
        throw Object.assign(new Error('gone'), { code: 'session_worktree_missing' })
      }),
    ).resolves.toMatchObject({ code: 'session_worktree_missing', errorKind: 'conflict' })
    await expect(
      errorFrameFor(async () => {
        throw Object.assign(new Error('odd'), { code: 'widget_not_found' })
      }),
    ).resolves.toMatchObject({ code: 'widget_not_found', errorKind: 'internal' })
    // A failure cannot claim a kind its code does not have.
    await expect(
      errorFrameFor(async () => {
        throw Object.assign(new Error('gone'), { code: 'run_changed', errorKind: 'not_found' })
      }),
    ).resolves.toMatchObject({ code: 'run_changed', errorKind: 'conflict' })
  })

  it('gives the client the kind the frame names, and none it does not', () => {
    expect(
      localSessionClientProtocolError(
        { kind: 'error', code: 'capability_denied', errorKind: 'authorization', message: 'No.' },
        'Failed.',
      ).errorKind,
    ).toBe('authorization')
    expect(
      localSessionClientProtocolError(
        { kind: 'error', code: 'capability_denied', errorKind: 'forbidden', message: 'No.' },
        'Failed.',
      ).errorKind,
    ).toBeUndefined()
  })
})
